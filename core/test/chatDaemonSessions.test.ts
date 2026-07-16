// core/test/chatDaemonSessions.test.ts
// THE ACCEPTANCE TEST: the chat page lists only chats the USER created.
//
// The vault's daemon runs Claude sessions when its crons fire, and they land in the SAME session
// store as the user's chats (the SDK keys that store by cwd — and the daemon's cwd IS the vault
// root). So the user's History filled up with "chats" they never opened, growing on every cron fire
// and every daemon relaunch. The daemon's sessions must keep EXISTING (crons need them, and a later
// surface will show them); they just must not appear here.
//
// These tests drive the REAL SDK store rather than mocking it: `CLAUDE_CONFIG_DIR` relocates it (the
// SDK memoizes the path keyed on that env var), so we can lay down real session transcripts and
// assert what listChatSessions/searchChatSessions actually return. Lives in its own file so the env
// swap can't reach chat.test.ts's live-`claude` tests, whose auth reads that same dir.
import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listChatSessions, searchChatSessions, excludeDaemonSessions } from "../src/chat";

const created: string[] = [];
let configDir: string;
let priorConfigDir: string | undefined;
let vault: string;
let projectDir: string;

beforeAll(() => {
  priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
  configDir = mkdtempSync(join(tmpdir(), "bismuth-chat-store-"));
  created.push(configDir);
  process.env.CLAUDE_CONFIG_DIR = configDir;
});

afterAll(() => {
  if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// The store only recognizes UUID-named transcripts (it validates the filename against a UUID
// regex and silently ignores anything else), so tests address sessions by a readable LABEL and
// this maps each to a stable synthetic UUID — keeping assertions legible without faking the store.
let idByLabel: Map<string, string>;
let labelById: Map<string, string>;
let minted = 0;

function sid(label: string): string {
  let id = idByLabel.get(label);
  if (!id) {
    id = `${String(++minted).padStart(8, "0")}-0000-4000-8000-000000000000`;
    idByLabel.set(label, id);
    labelById.set(id, label);
  }
  return id;
}

/** Session ids → the labels the test named them by. */
const labels = (ids: string[]): string[] => ids.map((id) => labelById.get(id) ?? id);

beforeEach(() => {
  // A fresh vault per test => a fresh project slug => an empty session store, with no cross-test bleed.
  // realpath matters on macOS: the SDK slugifies the RESOLVED dir (/var/... → /private/var/...).
  vault = realpathSync(mkdtempSync(join(tmpdir(), "bismuth-chat-vault-")));
  created.push(vault);
  projectDir = join(configDir, "projects", vault.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(projectDir, { recursive: true });
  idByLabel = new Map();
  labelById = new Map();
});

/** Write a real session transcript into the store. `age` orders the store (0 = newest). */
function writeSession(label: string, text: string, age = 0): void {
  const id = sid(label);
  const file = join(projectDir, `${id}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "summary", summary: `Summary of ${text}`, leafUuid: id }),
      JSON.stringify({
        type: "user",
        sessionId: id,
        uuid: id,
        cwd: vault,
        timestamp: new Date(Date.now() - age * 60_000).toISOString(),
        message: { role: "user", content: [{ type: "text", text }] },
      }),
    ].join("\n") + "\n",
  );
  // listSessions orders by mtime; set it explicitly so "newest" is deterministic.
  const when = (Date.now() - age * 60_000) / 1000;
  utimesSync(file, when, when);
}

/** Record sessions in the vault's durable daemon set — what the daemon's saveSessionId writes. */
function recordDaemonSessions(...sessionLabels: string[]): void {
  mkdirSync(join(vault, ".daemon"), { recursive: true });
  writeFileSync(join(vault, ".daemon", "session-ids"), sessionLabels.map(sid).join("\n") + "\n");
}

describe("listChatSessions — the History/resume picker lists only the user's chats", () => {
  test("a daemon cron session in the store is NOT listed; the user's chats are", async () => {
    writeSession("user-1", "my own chat about auth", 0);
    writeSession("daemon-1", "dream cron consolidating memory", 1);
    writeSession("user-2", "another chat I started", 2);
    recordDaemonSessions("daemon-1");

    const ids = (await listChatSessions(vault)).map((s) => s.sessionId);
    expect(labels(ids)).toEqual(["user-1", "user-2"]);
  });

  test("EVERY daemon session is excluded — not just the most recent (the refuted pointer mechanism)", async () => {
    // The prior attempt compared against `<vault>/.daemon/session-id`, a pointer at the LATEST
    // daemon session — so older cron sessions stayed visible. The durable set excludes all of them.
    writeSession("daemon-old", "cron run from last week", 3);
    writeSession("daemon-mid", "cron run from yesterday", 2);
    writeSession("daemon-new", "cron run an hour ago", 1);
    writeSession("user-1", "my chat", 0);
    recordDaemonSessions("daemon-old", "daemon-mid", "daemon-new");
    // A moving pointer at the newest daemon session — must not narrow the exclusion.
    writeFileSync(join(vault, ".daemon", "session-id"), sid("daemon-new"));

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("daemon sessions still EXIST on disk — this filters, it never deletes", async () => {
    writeSession("daemon-1", "cron run", 0);
    recordDaemonSessions("daemon-1");
    await listChatSessions(vault);
    // The transcript the daemon's crons depend on is untouched, and a future daemon-sessions
    // surface can still read it.
    expect(Bun.file(join(projectDir, `${sid("daemon-1")}.jsonl`)).size).toBeGreaterThan(0);
  });

  test("no daemon (no .daemon/session-ids) → every session lists, exactly as before", async () => {
    writeSession("user-1", "chat one", 1);
    writeSession("user-2", "chat two", 0);
    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId)).sort()).toEqual(["user-1", "user-2"]);
  });

  test("a store of ONLY daemon sessions yields an empty picker (not a list of the daemon's)", async () => {
    writeSession("daemon-1", "cron a", 1);
    writeSession("daemon-2", "cron b", 0);
    recordDaemonSessions("daemon-1", "daemon-2");
    expect(await listChatSessions(vault)).toEqual([]);
  });

  test("daemon sessions swamping the newest page still can't hide the user's chats", async () => {
    // The daemon mints a session per cron fire (~50/day for the seeded crons), so the newest N
    // sessions are easily ALL daemon. Filtering one fixed page would hand back an empty History
    // while the user's chats sat just past the cutoff — so the scan pages through them.
    const daemonIds = Array.from({ length: 120 }, (_, i) => `daemon-${i}`);
    daemonIds.forEach((id, i) => writeSession(id, `cron run ${i}`, i));
    for (let i = 0; i < 5; i++) writeSession(`user-${i}`, `my chat ${i}`, 200 + i);
    recordDaemonSessions(...daemonIds);

    const ids = (await listChatSessions(vault, 5)).map((s) => s.sessionId);
    expect(labels(ids)).toEqual(["user-0", "user-1", "user-2", "user-3", "user-4"]);
  });

  test("limit still caps the user's chats returned", async () => {
    for (let i = 0; i < 4; i++) writeSession(`user-${i}`, `chat ${i}`, i);
    writeSession("daemon-1", "cron run", 10);
    recordDaemonSessions("daemon-1");

    const got = await listChatSessions(vault, 2);
    expect(labels(got.map((s) => s.sessionId))).toEqual(["user-0", "user-1"]);
  });
});

describe("searchChatSessions — chat content search never surfaces a daemon session", () => {
  test("text that appears in BOTH a daemon session and a user chat matches only the user's", async () => {
    writeSession("user-1", "remember the vault refactor", 0);
    writeSession("daemon-1", "cron reviewing the vault refactor", 1);
    recordDaemonSessions("daemon-1");

    const hits = await searchChatSessions(vault, "vault refactor");
    expect(labels(hits.map((h) => h.sessionId))).toEqual(["user-1"]);
  });

  test("a phrase unique to a daemon session yields NO hits", async () => {
    writeSession("user-1", "unrelated chat", 0);
    writeSession("daemon-1", "dream consolidation pass over the memory graph", 1);
    recordDaemonSessions("daemon-1");

    expect(await searchChatSessions(vault, "dream consolidation")).toEqual([]);
  });

  test("without a daemon, search is unchanged", async () => {
    writeSession("user-1", "the vault refactor", 0);
    const hits = await searchChatSessions(vault, "vault refactor");
    expect(labels(hits.map((h) => h.sessionId))).toEqual(["user-1"]);
  });
});

describe("excludeDaemonSessions (the pure membership filter)", () => {
  const sessions = [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }];

  test("drops exactly the members of the daemon set", () => {
    expect(excludeDaemonSessions(sessions, new Set(["b"]))).toEqual([{ sessionId: "a" }, { sessionId: "c" }]);
  });

  test("an empty daemon set keeps everything (the no-daemon vault)", () => {
    expect(excludeDaemonSessions(sessions, new Set())).toEqual(sessions);
  });

  test("all-daemon → empty", () => {
    expect(excludeDaemonSessions(sessions, new Set(["a", "b", "c"]))).toEqual([]);
  });

  test("ids in the set that aren't in the store are simply irrelevant", () => {
    expect(excludeDaemonSessions(sessions, new Set(["z"]))).toEqual(sessions);
  });

  test("does not mutate its input", () => {
    const input = [{ sessionId: "a" }, { sessionId: "b" }];
    excludeDaemonSessions(input, new Set(["a"]));
    expect(input).toEqual([{ sessionId: "a" }, { sessionId: "b" }]);
  });
});
