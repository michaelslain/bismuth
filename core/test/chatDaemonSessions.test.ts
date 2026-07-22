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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, utimesSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listChatSessions,
  searchChatSessions,
  excludeDaemonSessions,
  filterSessionsByScope,
  resolveChatOrigin,
  parseChatScope,
} from "../src/chat";
import { isDaemonPrompt, firstUserMessageText } from "../src/chatDaemonLegacy";

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

/** A multi-turn session: `texts` become consecutive user messages, chained by parentUuid the way
 *  the SDK reconstructs a conversation. Lets a test distinguish "the transcript OPENS with X" from
 *  "X appears somewhere in the transcript" — the whole basis of daemon provenance. */
function writeMultiTurnSession(label: string, texts: string[], age = 0): void {
  const id = sid(label);
  const file = join(projectDir, `${id}.jsonl`);
  const lines = [JSON.stringify({ type: "summary", summary: `Summary of ${label}`, leafUuid: id })];
  texts.forEach((text, i) => {
    lines.push(
      JSON.stringify({
        type: "user",
        sessionId: id,
        uuid: `${id}-${i}`,
        parentUuid: i === 0 ? null : `${id}-${i - 1}`,
        cwd: vault,
        timestamp: new Date(Date.now() - age * 60_000 + i * 1000).toISOString(),
        message: { role: "user", content: [{ type: "text", text }] },
      }),
    );
  });
  writeFileSync(file, lines.join("\n") + "\n");
  const when = (Date.now() - age * 60_000) / 1000;
  utimesSync(file, when, when);
}

/** Record sessions in the vault's durable daemon set — what the daemon's saveSessionId writes. */
function recordDaemonSessions(...sessionLabels: string[]): void {
  mkdirSync(join(vault, ".daemon"), { recursive: true });
  writeFileSync(join(vault, ".daemon", "session-ids"), sessionLabels.map(sid).join("\n") + "\n");
}

// --- Day-one fixtures -------------------------------------------------------------------------
//
// These two strings are COPIED VERBATIM out of a real transcript in the author's store
// (~/.claude/projects/-Users-michaelslain-Documents-library-of-alexandria), not imported from the
// implementation — so these tests assert against what the daemon ACTUALLY wrote to disk. If the
// production classifier drifts from the bytes on real machines, these fail. Do not "fix" such a
// failure by importing the constants; the whole point is the independent anchor.
const REAL_BOOT_PROMPT =
  "You are now running as a background daemon for this vault. Check memory for prior context.";
const REAL_CRON_SUFFIX =
  "\n\nIMPORTANT: When you are done, print exactly [CRON_RESULT:SUCCESS] if the task completed successfully, or [CRON_RESULT:FAILURE] if it failed. This must be the last thing you print.";

/** The daemon's brain dir. A vault that has daemon sessions ALWAYS has this: the daemon keeps its
 *  identity, memory, crons and session pointer here, and a cron cannot fire without its own
 *  `.daemon/crons/<name>.md`. So every daemon-session fixture below creates it — a store with
 *  daemon transcripts but no `.daemon` is not a state a real machine can be in, and the backfill
 *  deliberately declines such a vault rather than conjure a system folder into it. */
function ensureDaemonDir(): void {
  mkdirSync(join(vault, ".daemon", "crons"), { recursive: true });
}

/** A boot session exactly as the pre-fix daemon minted it on every startup (129 of these exist in
 *  the real store). */
function writeBootSession(label: string, age = 0): void {
  ensureDaemonDir();
  writeSession(label, REAL_BOOT_PROMPT, age);
}

/** A cron session exactly as fireJob mints it: `[Cron: <name>] <prompt>` + the result instruction
 *  (759 of these exist in the real store). */
function writeCronSession(label: string, name: string, prompt: string, age = 0): void {
  ensureDaemonDir();
  writeSession(label, `[Cron: ${name}] ${prompt}${REAL_CRON_SUFFIX}`, age);
}

/** The pointer file — a MOVING single value naming only the daemon's most recent session. On the
 *  real machine it names a session that is not any of the ones the user is complaining about. */
function writePointer(label: string): void {
  mkdirSync(join(vault, ".daemon"), { recursive: true });
  writeFileSync(join(vault, ".daemon", "session-id"), sid(label));
}

// --- DAY ONE: the only state a real user can ship into -----------------------------------------
//
// The durable set is written FROM THE FIX FORWARD. So on the machine that reported this bug, the
// instant the fix lands the vault has:
//   * ~1000 transcripts, of which 129 are daemon BOOT sessions and 759 are cron sessions,
//   * NO `.daemon/session-ids` file at all,
//   * a `.daemon/session-id` pointer naming ONE session that is not any of those 129.
// Every other test in this file seeds the durable set up front, which is impossible at ship time —
// they prove the filter mechanism, not the user's outcome. These tests fix that: they seed NOTHING
// and assert the picker is clean anyway, which is the actual acceptance criterion for the card.
describe("day one — a store full of daemon sessions and NO durable set yet", () => {
  test("the 129-boot-sessions case: pre-existing daemon boot sessions are NOT listed", async () => {
    writeBootSession("boot-1", 1);
    writeBootSession("boot-2", 2);
    writeBootSession("boot-3", 3);
    writeSession("user-1", "can u fix Dynamical Systems so it opens in currently reading", 0);
    // The pointer names a DIFFERENT session (as it does on the real machine) — it cannot rescue
    // any of the boot sessions, which is exactly why the pointer-backfill was not enough.
    writePointer("boot-3");

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("the 759-cron-sessions case: pre-existing cron sessions are NOT listed", async () => {
    writeCronSession("cron-dream", "dream", "Consolidate this vault's memory graph.", 1);
    writeCronSession("cron-review", "vault-review", "Review the vault for stale notes.", 2);
    writeCronSession("cron-book", "book-quotes", "Pull quotes from today's reading.", 3);
    writeSession("user-1", "what does hegemony maen", 0);

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("the real mix — boot + cron + user chats, nothing seeded — leaves only the user's chats", async () => {
    writeSession("user-1", "can we remove BACS Tasks", 0);
    writeBootSession("boot-1", 1);
    writeCronSession("cron-1", "dream", "Consolidate memory.", 2);
    writeSession("user-2", "is my data safe with u", 3);
    writeBootSession("boot-2", 4);
    writeCronSession("cron-2", "bismuth-operator", "Work the board.", 5);
    writePointer("cron-2");

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1", "user-2"]);
  });

  test("day-one daemon sessions are excluded from content search too", async () => {
    writeSession("user-1", "remember the vault refactor", 0);
    writeCronSession("cron-1", "vault-review", "review the vault refactor notes", 1);

    const hits = await searchChatSessions(vault, "vault refactor");
    expect(labels(hits.map((h) => h.sessionId))).toEqual(["user-1"]);
  });

  test("day-one daemon sessions swamping the newest pages still can't hide the user's chats", async () => {
    // The shape of the real store: ~89% daemon, and the user's chats sit far past the first page.
    for (let i = 0; i < 60; i++) writeBootSession(`boot-${i}`, i);
    for (let i = 0; i < 60; i++) writeCronSession(`cron-${i}`, "dream", `run ${i}`, 60 + i);
    for (let i = 0; i < 3; i++) writeSession(`user-${i}`, `my chat ${i}`, 200 + i);

    expect(labels((await listChatSessions(vault, 3)).map((s) => s.sessionId))).toEqual([
      "user-0",
      "user-1",
      "user-2",
    ]);
  });

  test("a USER chat that merely TALKS about crons is still the user's — never hidden", async () => {
    // The false positive that matters: hiding a user's own conversation is far worse than missing
    // a daemon chat. A user discussing the cron machinery (quoting the marker, pasting the boot
    // prompt, asking what the prefix in their logs means) must survive, because the daemon's
    // signature is the prompt it SENT as its opening message, not a topic anyone can mention.
    //
    // This MUST run in a vault where the backfill is active (a real daemon session present), or it
    // asserts nothing: with no `.daemon` the scan is skipped, nothing is filtered, and the test
    // passes however broken the classifier is. Each of these three chats is a near-miss aimed at
    // one specific over-reach — matching the boot prompt by `includes` instead of equality, or
    // matching a cron on the `[Cron: ` prefix / the result marker alone.
    writeCronSession("cron-1", "dream", "Consolidate memory.", 3);
    writeSession("user-1", "why does my dream cron keep printing [CRON_RESULT:SUCCESS]?", 0);
    writeSession("user-2", "[Cron: dream] — what does this prefix in my logs mean?", 1);
    writeSession("user-3", `can you explain this: ${REAL_BOOT_PROMPT} — where does it come from?`, 2);

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual([
      "user-1",
      "user-2",
      "user-3",
    ]);
  });

  test("a user chat quoting a cron prompt IN FULL is still the user's (the prompt is not the opener)", async () => {
    // The sharpest near-miss: every daemon-authored anchor is present verbatim in the body, but the
    // user opened the conversation themselves. Provenance is the FIRST message, never a body scan.
    writeCronSession("cron-1", "dream", "Consolidate memory.", 1);
    writeSession(
      "user-1",
      `my dream cron sends this, is it too long?\n\n[Cron: dream] Consolidate memory.${REAL_CRON_SUFFIX}`,
      0,
    );

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("a user chat that LATER pastes the boot prompt verbatim is still the user's", async () => {
    // Provenance is the transcript's OPENING message, not "any message matches". A user who asks
    // about the daemon and then pastes its prompt to show what they mean produces a transcript
    // containing the exact literal — and it is unambiguously their chat, because they opened it.
    writeCronSession("cron-1", "dream", "Consolidate memory.", 2);
    writeMultiTurnSession("user-1", ["what is this thing my daemon says?", REAL_BOOT_PROMPT], 0);
    // And the daemon's own boot session, whose FIRST message is the literal, is still caught.
    writeMultiTurnSession("boot-1", [REAL_BOOT_PROMPT, "continuing the boot session"], 1);

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("the migration NEVER deletes a daemon transcript — the crons still need them", async () => {
    writeCronSession("cron-1", "dream", "Consolidate memory.", 0);
    await listChatSessions(vault);
    expect(Bun.file(join(projectDir, `${sid("cron-1")}.jsonl`)).size).toBeGreaterThan(0);
  });
});

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

  test("every row is tagged origin \"user\" in the default scope", async () => {
    writeSession("user-1", "my chat", 0);
    writeSession("daemon-1", "cron run", 1);
    recordDaemonSessions("daemon-1");

    const rows = await listChatSessions(vault);
    expect(rows.map((s) => s.origin)).toEqual(["user"]);
  });
});

// ACCEPTANCE (card B): a dedicated place/filter to access the daemon's own chats — the `scope`
// param on the SAME listChatSessions the History picker calls, not a second endpoint.
describe("listChatSessions(scope: \"daemon\") — the dedicated place to access daemon chats", () => {
  test("scope daemon returns exactly the daemon's sessions, each tagged origin \"daemon\"", async () => {
    writeSession("user-1", "my own chat", 0);
    writeSession("daemon-1", "dream cron consolidating memory", 1);
    writeSession("daemon-2", "vault-review cron", 2);
    recordDaemonSessions("daemon-1", "daemon-2");

    const rows = await listChatSessions(vault, 50, "daemon");
    expect(labels(rows.map((s) => s.sessionId)).sort()).toEqual(["daemon-1", "daemon-2"]);
    expect(rows.every((s) => s.origin === "daemon")).toBe(true);
  });

  test("scope daemon on a vault whose daemon never ran is an empty list, not the user's chats", async () => {
    writeSession("user-1", "my own chat", 0);
    expect(await listChatSessions(vault, 50, "daemon")).toEqual([]);
  });

  test("scope all returns both, each correctly tagged — the mixed list the icon distinguishes", async () => {
    writeSession("user-1", "my own chat", 0);
    writeSession("daemon-1", "dream cron consolidating memory", 1);
    recordDaemonSessions("daemon-1");

    const rows = await listChatSessions(vault, 50, "all");
    const origins = new Map(labels(rows.map((s) => s.sessionId)).map((label, i) => [label, rows[i]!.origin]));
    expect(origins.get("user-1")).toBe("user");
    expect(origins.get("daemon-1")).toBe("daemon");
  });

  test("an invalid scope falls back to the safe default (user) rather than leaking daemon chats", () => {
    expect(parseChatScope("bogus")).toBe("user");
    expect(parseChatScope(undefined)).toBe("user");
    expect(parseChatScope("daemon")).toBe("daemon");
    expect(parseChatScope("all")).toBe("all");
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

  test("scope daemon/all reach the daemon's transcripts that the default scope skips", async () => {
    writeSession("user-1", "unrelated chat", 0);
    writeSession("daemon-1", "dream consolidation pass over the memory graph", 1);
    recordDaemonSessions("daemon-1");

    // Default scope ("user") never finds it — same as the describe block above.
    expect(await searchChatSessions(vault, "dream consolidation")).toEqual([]);

    const viaDaemon = await searchChatSessions(vault, "dream consolidation", 100, "daemon");
    expect(labels(viaDaemon.map((h) => h.sessionId))).toEqual(["daemon-1"]);
    expect(viaDaemon[0]!.origin).toBe("daemon");

    const viaAll = await searchChatSessions(vault, "dream consolidation", 100, "all");
    expect(labels(viaAll.map((h) => h.sessionId))).toEqual(["daemon-1"]);
  });
});

describe("the backfill is one-time and composes with the daemon's own record", () => {
  test("it records the daemon's sessions once and does not rescan", async () => {
    writeCronSession("cron-1", "dream", "Consolidate memory.", 1);
    writeSession("user-1", "my chat", 0);
    const legacy = join(vault, ".daemon", "session-ids-legacy");

    expect(existsSync(legacy)).toBe(false);
    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
    expect(readFileSync(legacy, "utf-8").trim()).toBe(sid("cron-1"));

    // The written file IS the marker: a second open reuses it rather than walking the store again.
    const stamp = statSync(legacy).mtimeMs;
    await listChatSessions(vault);
    expect(statSync(legacy).mtimeMs).toBe(stamp);
  });

  test("a completed scan that found nothing still counts as done (empty file, no rescan)", async () => {
    // Guards the marker choice: if "empty" were treated as "never ran", every History open on a
    // daemon vault with no legacy sessions would re-walk the whole store forever.
    mkdirSync(join(vault, ".daemon"), { recursive: true });
    writeSession("user-1", "my chat", 0);

    await listChatSessions(vault);
    const legacy = join(vault, ".daemon", "session-ids-legacy");
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(legacy, "utf-8")).toBe("");

    const stamp = statSync(legacy).mtimeMs;
    await listChatSessions(vault);
    expect(statSync(legacy).mtimeMs).toBe(stamp);
  });

  test("a vault with NO daemon is left alone — no scan, no .daemon conjured into it", async () => {
    writeSession("user-1", "chat one", 0);
    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
    expect(existsSync(join(vault, ".daemon"))).toBe(false);
  });

  test("backfilled ids UNION the daemon's own record — both halves filter", async () => {
    // The steady state right after the fix: history recovered by the scan, plus sessions the
    // daemon has recorded since. Reading either file alone would leak the other's sessions.
    writeCronSession("legacy-cron", "dream", "Consolidate memory.", 2);
    writeSession("new-daemon-session", "a session recorded by saveSessionId, not scannable", 1);
    writeSession("user-1", "my chat", 0);
    recordDaemonSessions("new-daemon-session");

    expect(labels((await listChatSessions(vault)).map((s) => s.sessionId))).toEqual(["user-1"]);
  });

  test("concurrent opens both get a correct picker and a clean file (no torn write)", async () => {
    // History and its search box can both fire before either finishes; they share one in-flight
    // scan, but the property that MATTERS is that neither observes a half-written set.
    writeCronSession("cron-1", "dream", "Consolidate memory.", 1);
    writeSession("user-1", "my chat", 0);

    const [a, b] = await Promise.all([listChatSessions(vault), listChatSessions(vault)]);
    expect(labels(a.map((s) => s.sessionId))).toEqual(["user-1"]);
    expect(labels(b.map((s) => s.sessionId))).toEqual(["user-1"]);
    expect(readFileSync(join(vault, ".daemon", "session-ids-legacy"), "utf-8").trim()).toBe(sid("cron-1"));
  });
});

describe("isDaemonPrompt (the pure classifier)", () => {
  // The counts below are measured against the real reporting store (997 sessions): every one of
  // its 129 boot and 759 cron transcripts matches, and none of its 109 user chats do.
  test("the exact boot prompt the pre-fix daemon sent on every startup", () => {
    expect(isDaemonPrompt(REAL_BOOT_PROMPT)).toBe(true);
  });

  test("a cron prompt: the daemon's prefix AND its result instruction", () => {
    expect(isDaemonPrompt(`[Cron: dream] Consolidate memory.${REAL_CRON_SUFFIX}`)).toBe(true);
  });

  test("surrounding whitespace does not defeat the match", () => {
    expect(isDaemonPrompt(`\n  ${REAL_BOOT_PROMPT}  \n`)).toBe(true);
  });

  test("the user-editable middle of a cron prompt is irrelevant to the verdict", () => {
    // job.name and job.prompt come from a file the user edits; only the wrapper is the daemon's.
    expect(isDaemonPrompt(`[Cron: my-own-job] anything at all${REAL_CRON_SUFFIX}`)).toBe(true);
  });

  test("the boot prompt EMBEDDED in a user's sentence is not the daemon", () => {
    expect(isDaemonPrompt(`what is this: ${REAL_BOOT_PROMPT}`)).toBe(false);
  });

  test("the cron prefix ALONE is not enough (a user can type it)", () => {
    expect(isDaemonPrompt("[Cron: dream] what does this mean?")).toBe(false);
  });

  test("the result instruction ALONE is not enough (a user can paste it)", () => {
    expect(isDaemonPrompt(`please do this${REAL_CRON_SUFFIX}`)).toBe(false);
  });

  test("ordinary user prose is never the daemon", () => {
    expect(isDaemonPrompt("can u fix Dynamical Systems so it opens in currently reading")).toBe(false);
    expect(isDaemonPrompt("")).toBe(false);
  });
});

describe("firstUserMessageText (the pure opener extractor)", () => {
  const msg = (type: string, text: string) => ({ type, uuid: "u", session_id: "s", parent_tool_use_id: null, message: { role: type, content: [{ type: "text", text }] } }) as never;

  test("reads the opening user message's text", () => {
    expect(firstUserMessageText([msg("user", "hello"), msg("user", "world")])).toBe("hello");
  });

  test("an assistant-first transcript is unjudgeable → null (treated as the user's)", () => {
    expect(firstUserMessageText([msg("assistant", "hi there")])).toBeNull();
  });

  test("an empty transcript → null", () => {
    expect(firstUserMessageText([])).toBeNull();
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

describe("resolveChatOrigin (the pure origin classifier)", () => {
  test("a session id in the daemon's set is \"daemon\"", () => {
    expect(resolveChatOrigin("a", new Set(["a", "b"]))).toBe("daemon");
  });

  test("a session id absent from the set is \"user\"", () => {
    expect(resolveChatOrigin("z", new Set(["a", "b"]))).toBe("user");
  });

  test("an empty set (no daemon / never run / unreadable) makes everything the user's", () => {
    expect(resolveChatOrigin("anything", new Set())).toBe("user");
  });
});

describe("filterSessionsByScope (the pure scope filter powering the History picker's filter)", () => {
  const sessions = [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }];
  const daemonIds = new Set(["b"]);

  test("\"user\" keeps everything but the daemon's, exactly like excludeDaemonSessions", () => {
    expect(filterSessionsByScope(sessions, daemonIds, "user")).toEqual([{ sessionId: "a" }, { sessionId: "c" }]);
  });

  test("\"daemon\" keeps exactly the daemon's", () => {
    expect(filterSessionsByScope(sessions, daemonIds, "daemon")).toEqual([{ sessionId: "b" }]);
  });

  test("\"all\" keeps everything, unfiltered", () => {
    expect(filterSessionsByScope(sessions, daemonIds, "all")).toEqual(sessions);
  });

  test("an empty daemon set: \"user\" keeps everything, \"daemon\" keeps nothing (never invert the safety direction)", () => {
    expect(filterSessionsByScope(sessions, new Set(), "user")).toEqual(sessions);
    expect(filterSessionsByScope(sessions, new Set(), "daemon")).toEqual([]);
  });

  test("does not mutate its input", () => {
    const input = [{ sessionId: "a" }, { sessionId: "b" }];
    filterSessionsByScope(input, daemonIds, "all");
    expect(input).toEqual([{ sessionId: "a" }, { sessionId: "b" }]);
  });
});
