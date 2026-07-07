// core/test/daemonPages.test.ts
// Unit-tests core/src/daemonPages.ts against a mkdtemp'd vault. Each test writes a fake
// `.daemon/pages/<slug>.md` (+ optionally a `.state/<slug>.json` sidecar) directly to disk and
// asserts listDaemonPages/resolvePage/markPageFailed's contract.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  vaultPagesDir,
  pageStateDir,
  pageTriggerDir,
  readPageState,
  listDaemonPages,
  resolvePage,
  markPageFailed,
} from "../src/daemonPages";

const created: string[] = [];

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-daemon-pages-"));
  created.push(vault);
  return vault;
}

/** Write a page's .md at .daemon/pages/<slug>.md. */
function writePage(vault: string, slug: string, frontmatter: string, body = "body text"): void {
  mkdirSync(vaultPagesDir(vault), { recursive: true });
  writeFileSync(join(vaultPagesDir(vault), `${slug}.md`), `---\n${frontmatter}\n---\n\n${body}\n`);
}

/** Write a page's sidecar directly (bypassing writePageState, which is module-private). */
function writeState(vault: string, slug: string, state: Record<string, unknown>): void {
  mkdirSync(pageStateDir(vault), { recursive: true });
  writeFileSync(join(pageStateDir(vault), `${slug}.json`), JSON.stringify(state));
}

afterEach(() => {
  for (const v of created.splice(0)) {
    try { rmSync(v, { recursive: true, force: true }); } catch { /* */ }
  }
});

test("listDaemonPages returns [] when the pages dir doesn't exist yet (never throws)", () => {
  const vault = makeVault();
  expect(listDaemonPages(vault, 7)).toEqual([]);
});

test("listDaemonPages synthesizes 'pending' when there's no sidecar yet", () => {
  const vault = makeVault();
  writePage(
    vault,
    "reply-drafts",
    `type: daemon-page\ntitle: "Reply drafts"\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    kind: primary\n    prompt: "Send the replies."`,
  );
  const pages = listDaemonPages(vault, 7);
  expect(pages).toHaveLength(1);
  expect(pages[0]).toMatchObject({
    path: ".daemon/pages/reply-drafts.md",
    slug: "reply-drafts",
    title: "Reply drafts",
    status: "pending",
    body: "\nbody text\n", // blank line after the frontmatter fence survives verbatim
  });
  expect(pages[0].actions).toEqual([{ id: "send", label: "Send", kind: "primary", model: undefined, timeout: undefined, prompt: "Send the replies." }]);
});

test("listDaemonPages tolerates malformed/missing frontmatter fields — never throws", () => {
  const vault = makeVault();
  mkdirSync(vaultPagesDir(vault), { recursive: true });
  writeFileSync(join(vaultPagesDir(vault), "broken.md"), "no frontmatter at all, just prose");
  const pages = listDaemonPages(vault, 7);
  expect(pages).toHaveLength(1);
  expect(pages[0].title).toBe("broken"); // falls back to the slug
  expect(pages[0].actions).toEqual([]);
  expect(pages[0].createdAt).toBe("");
});

test("listDaemonPages merges the sidecar's live status over the synthesized 'pending'", () => {
  const vault = makeVault();
  writePage(vault, "p1", `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z`);
  writeState(vault, "p1", { status: "working", pressedAction: "send", pressedAt: "2026-07-06T09:00:00.000Z" });
  const [page] = listDaemonPages(vault, 7);
  expect(page.status).toBe("working");
  expect(page.pressedAction).toBe("send");
});

test("resolvePage: dismiss (no prompt) resolves entirely locally — no trigger dropped", () => {
  const vault = makeVault();
  writePage(
    vault,
    "p1",
    `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: discard\n    label: Discard\n    kind: danger`,
  );
  const result = resolvePage(vault, ".daemon/pages/p1.md", "discard");
  expect(result).toEqual({ status: "dismissed", alreadyResolved: false });
  expect(readPageState(vault, "p1")?.status).toBe("dismissed");
  expect(existsSync(join(pageTriggerDir(vault), "p1"))).toBe(false);
});

test("resolvePage: approve (has prompt) writes 'working' with the resolved prompt AND drops a trigger", () => {
  const vault = makeVault();
  writePage(
    vault,
    "p1",
    `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    kind: primary\n    model: sonnet\n    timeout: 120\n    prompt: "Send it."`,
  );
  const result = resolvePage(vault, ".daemon/pages/p1.md", "send");
  expect(result).toEqual({ status: "working", alreadyResolved: false });
  const state = readPageState(vault, "p1");
  expect(state).toMatchObject({
    status: "working",
    pressedAction: "send",
    prompt: "Send it.",
    model: "sonnet",
    timeoutSecs: 120,
  });
  // The trigger file the daemon's processPageTriggers polls (~5s), named by slug.
  expect(existsSync(join(pageTriggerDir(vault), "p1"))).toBe(true);
});

test("resolvePage: approve with no explicit timeout defaults to 300s", () => {
  const vault = makeVault();
  writePage(
    vault,
    "p1",
    `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    prompt: "go"`,
  );
  resolvePage(vault, ".daemon/pages/p1.md", "send");
  expect(readPageState(vault, "p1")?.timeoutSecs).toBe(300);
});

test("resolvePage: unknown action id throws (400)", () => {
  const vault = makeVault();
  writePage(vault, "p1", `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send`);
  expect(() => resolvePage(vault, ".daemon/pages/p1.md", "nope")).toThrow();
});

test("resolvePage: missing page throws (404)", () => {
  const vault = makeVault();
  expect(() => resolvePage(vault, ".daemon/pages/ghost.md", "send")).toThrow();
});

test("resolvePage: rejects a path outside .daemon/pages/ (traversal guard)", () => {
  const vault = makeVault();
  expect(() => resolvePage(vault, "../outside.md", "send")).toThrow();
  expect(() => resolvePage(vault, ".daemon/crons/dream.md", "send")).toThrow();
});

test("resolvePage: idempotent when already terminal (double-click / cross-window race guard)", () => {
  const vault = makeVault();
  writePage(vault, "p1", `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    prompt: go`);
  writeState(vault, "p1", { status: "done", daemonNote: "Sent.", completedAt: "2026-07-06T09:00:00.000Z" });
  const result = resolvePage(vault, ".daemon/pages/p1.md", "send");
  expect(result).toEqual({ status: "done", alreadyResolved: true });
  // No trigger dropped — an already-resolved page never re-fires.
  expect(existsSync(join(pageTriggerDir(vault), "p1"))).toBe(false);
});

test("markPageFailed force-writes 'failed' with no daemon involvement", () => {
  const vault = makeVault();
  writePage(vault, "p1", `type: daemon-page\ntitle: P1\ncreatedAt: 2026-07-06T08:00:00.000Z`);
  writeState(vault, "p1", { status: "working", pressedAction: "send", pressedAt: "2026-07-06T08:05:00.000Z" });
  markPageFailed(vault, ".daemon/pages/p1.md");
  const state = readPageState(vault, "p1");
  expect(state?.status).toBe("failed");
  expect(state?.daemonNote).toContain("Marked failed");
  expect(typeof state?.completedAt).toBe("string");
});

test("listDaemonPages GCs a terminal page past the retention window (page + sidecar deleted)", () => {
  const vault = makeVault();
  writePage(vault, "stale", `type: daemon-page\ntitle: Stale\ncreatedAt: 2026-01-01T00:00:00.000Z`);
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
  writeState(vault, "stale", { status: "done", completedAt: old });

  const pages = listDaemonPages(vault, 7); // 7-day retention
  expect(pages).toEqual([]);
  expect(existsSync(join(vaultPagesDir(vault), "stale.md"))).toBe(false);
  expect(existsSync(join(pageStateDir(vault), "stale.json"))).toBe(false);
});

test("listDaemonPages keeps a terminal page still within the retention window", () => {
  const vault = makeVault();
  writePage(vault, "recent", `type: daemon-page\ntitle: Recent\ncreatedAt: 2026-01-01T00:00:00.000Z`);
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
  writeState(vault, "recent", { status: "done", completedAt: recent });

  const pages = listDaemonPages(vault, 7);
  expect(pages).toHaveLength(1);
  expect(existsSync(join(vaultPagesDir(vault), "recent.md"))).toBe(true);
});

test("listDaemonPages never GCs a pending/working page regardless of age", () => {
  const vault = makeVault();
  writePage(vault, "old-pending", `type: daemon-page\ntitle: Old\ncreatedAt: 2020-01-01T00:00:00.000Z`);
  const pages = listDaemonPages(vault, 7);
  expect(pages).toHaveLength(1);
  expect(pages[0].status).toBe("pending");
});
