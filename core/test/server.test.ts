import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";
import { writeNote, readNote } from "../src/files";
import { readSettings } from "../src/settings";
import { resetRelay } from "../src/relay";
import { createTerminalSession, killSession } from "../src/terminal";
import { makeSampleVault } from "./helpers";

// Isolate the daemon machine dir + the legacy claude-bot source for the WHOLE file. A
// daemon-enabled server (the merged-brain test) runs migrateDaemonState on boot AND again from
// the debounced settings-change handler that fires ~250ms after reconcile rewrites settings.yaml
// — the latter can outlive a per-test env restore. Set these at module scope (never restored)
// so neither path can ever touch the real ~/.claude-bot or write the real ~/.bismuth/daemon.
process.env.BISMUTH_DAEMON_DIR = mkdtempSync(join(tmpdir(), "bismuth-srv-machine-"));
process.env.BISMUTH_LEGACY_CLAUDE_BOT_DIR = join(tmpdir(), "bismuth-no-legacy-claude-bot-xyz");
// BISMUTH_DAEMON_BIN must ALSO be faked: daemonInstall.ts's daemonBinPath() falls back to the
// real installed ~/.bismuth/bin/bismuth-daemon when this is unset, and the "POST /daemon/setup"
// test below calls runSetup(), which spawns whatever daemonBinPath() resolves to. On a machine
// with the app installed, that's the REAL daemon binary's `--ensure-installed` — which rewrites
// the REAL, hardcoded ~/Library/LaunchAgents/com.bismuth.daemon.plist (daemonConfigPath() in
// daemon/src/lib/platform.ts is NOT derived from BISMUTH_DAEMON_DIR) with logsDir/workDir
// pointing at this test's throwaway tmp dir, and reloads (SIGTERMs + restarts) the live service.
// Pointing BISMUTH_DAEMON_BIN at a path that can't exist makes every daemonInstall.ts call a
// pure no-op (existsSync(bin) is false), so nothing is ever spawned.
process.env.BISMUTH_DAEMON_BIN = join(tmpdir(), "bismuth-no-real-daemon-binary-xyz");

test("GET /graph returns the merged brain graph", async () => {
  const { vault, memory } = await makeSampleVault();
  // The 3rd brain is gated on the daemon and sourced from <vault>/.daemon/memory.
  await writeNote(vault, ".settings", "daemon:\n  enabled: true\n");
  await writeNote(vault, ".daemon/memory/michael-profile.md", "Profile of the user. He is working on [[internship]] and [[essay]].\n");
  // Daemon enabled → boot + the debounced settings-change handler both run migrateDaemonState;
  // the module-level BISMUTH_DAEMON_DIR / BISMUTH_LEGACY_CLAUDE_BOT_DIR isolation above keeps
  // both off the real machine.
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // appConfig loads async at boot, so poll briefly until the daemon-gated 3rd brain lands.
    let g: any;
    for (let i = 0; i < 40; i++) {
      g = await (await fetch(`${base}/graph`)).json();
      if (g.nodes.some((n: any) => n.id === "mem:michael-profile")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const ids = g.nodes.map((n: any) => n.id);
    expect(ids).toContain("internship");
    expect(ids).toContain("mem:michael-profile");
    expect(g.edges).toContainEqual({ from: "mem:michael-profile", to: "internship", kind: "about" });

    const before = await (await fetch(`${base}/file?path=essay.md`)).text();
    expect(before).toContain("Essay");

    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta).toEqual({ status: "in-progress", priority: 1, tags: ["logistics"] });
  } finally {
    server.stop(true);
  }
});

test("GET /config returns the launch vault and memory paths", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg).toEqual({ vault, memory });
  } finally {
    server.stop(true);
  }
});

test("GET /agent-graph returns an object with nodes and edges arrays", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const ag = await (await fetch(`${base}/agent-graph`)).json();
    expect(Array.isArray(ag.nodes)).toBe(true);
    expect(Array.isArray(ag.edges)).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("relay ingest routes reject missing required fields", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post("/relay/session", { sessionId: "s1" })).status).toBe(400); // no terminalId
    expect((await post("/relay/subagent/start", { agentId: "a1" })).status).toBe(400); // no parentSessionId
  } finally {
    server.stop(true);
  }
});

test("GET /daemon/graph returns a graph with the daemon hub node (never throws)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/daemon/graph`);
    expect(res.status).toBe(200);
    const g = await res.json();
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);
    // The daemon hub is always present, even with no crons/processes.
    expect(g.nodes.some((n: any) => n.kind === "daemon")).toBe(true);
    // No frontend "you" node is ever emitted by the backend here.
    expect(g.nodes.some((n: any) => n.kind === "self")).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("writing a .daemon/pages/*.md page bumps dirty.tree (the DAEMON_PAGE_RE noise-classifier fix)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Prime — gets SSE headers flushed (see the identical prime step in the /events tests above).
    await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prime.md", contents: "x" }),
    });

    const res = await fetch(`${base}/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Without the DAEMON_PAGE_RE fix, isDaemonRuntimeNoise would swallow this as .daemon/**
    // runtime churn — no tree dirty, no SSE-worthy signal (same failure mode crons/processes
    // definitions had before DAEMON_DEF_RE).
    await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".daemon/pages/reply-drafts.md", contents: "---\ntype: daemon-page\ntitle: Hi\n---\n\nbody" }),
    });

    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        if (!f.startsWith("data: ")) continue;
        const payload = JSON.parse(f.slice(6));
        if (Array.isArray(payload.paths) && payload.paths.includes(".daemon/pages/reply-drafts.md")) {
          expect(payload.dirty.tree).toBe(true);
          await reader.cancel();
          return;
        }
      }
    }
    throw new Error(`no SSE frame mentioned the page path; buf=${buf}`);
  } finally {
    server.stop(true);
  }
});

test("GET /daemon/pages + POST /daemon/pages/resolve round-trip end-to-end", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(
    vault,
    ".daemon/pages/reply-drafts.md",
    `---\ntype: daemon-page\ntitle: "Reply drafts"\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    kind: primary\n    prompt: "Send it."\n  - id: discard\n    label: Discard\n    kind: danger\n---\n\nHi Jane\n`,
  );
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const pages = await (await fetch(`${base}/daemon/pages`)).json();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ path: ".daemon/pages/reply-drafts.md", title: "Reply drafts", status: "pending" });

    // Dismiss (no daemon round-trip): resolves immediately, no trigger.
    const dismiss = await fetch(`${base}/daemon/pages/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".daemon/pages/reply-drafts.md", actionId: "discard" }),
    });
    expect((await dismiss.json())).toEqual({ status: "dismissed", alreadyResolved: false });

    const after = await (await fetch(`${base}/daemon/pages`)).json();
    expect(after[0].status).toBe("dismissed");

    // Unknown action → 400.
    const bad = await fetch(`${base}/daemon/pages/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".daemon/pages/reply-drafts.md", actionId: "nope" }),
    });
    expect(bad.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("POST /daemon/pages/mark-failed force-writes failed with no daemon involvement", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(
    vault,
    ".daemon/pages/stuck.md",
    `---\ntype: daemon-page\ntitle: Stuck\ncreatedAt: 2026-07-06T08:00:00.000Z\nactions:\n  - id: send\n    label: Send\n    prompt: go\n---\n\nbody\n`,
  );
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/daemon/pages/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".daemon/pages/stuck.md", actionId: "send" }),
    });
    let pages = await (await fetch(`${base}/daemon/pages`)).json();
    expect(pages[0].status).toBe("working");

    const res = await fetch(`${base}/daemon/pages/mark-failed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".daemon/pages/stuck.md" }),
    });
    expect(res.ok).toBe(true);
    pages = await (await fetch(`${base}/daemon/pages`)).json();
    expect(pages[0].status).toBe("failed");
  } finally {
    server.stop(true);
  }
});

test("relay hooks → registry → /agent-graph renders the session + subagent tree", async () => {
  resetRelay();
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  // A live terminal makes its id pass the agent-graph "open tab" filter.
  const term = createTerminalSession({ cwd: vault, cols: 80, rows: 24 });
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    await post("/relay/session", { sessionId: "sess-1", terminalId: term.id, cwd: "/x/my-proj" });
    await post("/relay/subagent/start", { parentSessionId: "sess-1", agentId: "ag-1", agentType: "Explore" });
    const g = await (await fetch(`${base}/agent-graph`)).json();
    expect(g.nodes.find((n: any) => n.id === "agent:sess:sess-1")).toMatchObject({ kind: "agent", label: "my-proj" });
    expect(g.nodes.find((n: any) => n.id === "agent:sub:ag-1")).toMatchObject({ kind: "agent", label: "Explore", parent: "agent:sess:sess-1" });
    expect(g.edges).toContainEqual({ from: "agent:sess:sess-1", to: "agent:sub:ag-1", kind: "message" });
  } finally {
    killSession(term.id);
    resetRelay();
    server.stop(true);
  }
});


test("GET /version returns { version: <number> }", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await (await fetch(`${base}/version`)).json();
    expect(typeof res.version).toBe("number");
  } finally {
    server.stop(true);
  }
});

test("GET /file with missing path parameter returns 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file`);
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /file with nonexistent file returns empty string with 200", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file?path=nonexistent.md`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("");
  } finally {
    server.stop(true);
  }
});

test("OPTIONS request returns CORS headers", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/graph`, { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  } finally {
    server.stop(true);
  }
});

test("GET /meta with missing path parameter returns 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/meta`);
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /meta for nonexistent file returns empty object", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/meta?path=nonexistent.md`);
    const data = await res.json();
    expect(data).toEqual({});
  } finally {
    server.stop(true);
  }
});

test("GET /tree returns array of { path } entries", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/tree`);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.every((e: any) => typeof e.path === "string")).toBe(true);
    expect(entries.map((e: any) => e.path)).toContain("housing.md");
    expect(entries.every((e: any) => e.kind === "file" || e.kind === "dir")).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /tree surfaces a note's `icon` frontmatter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-tree-icon-"));
  await writeNote(dir, "fire.md", "---\nicon: 🔥\n---\nhot");
  await writeNote(dir, "plain.md", "no frontmatter");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "fire.md", icon: "🔥", kind: "file" });
    expect(entries).toContainEqual({ path: "plain.md", kind: "file" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon sets a directory icon surfaced on GET /tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-icon-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    expect(res.status).toBe(200);

    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", icon: "Folder", kind: "dir" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon with empty icon removes a previously-set directory icon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-icon-clear-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (body: unknown) =>
    fetch(`${base}/folder-icon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    await post({ path: "projects", icon: "Folder" });
    let entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", icon: "Folder", kind: "dir" });

    await post({ path: "projects", icon: "" });
    entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", kind: "dir" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon persists folderIcons into settings.yaml", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-icon-persist-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    const res = await readSettings(dir);
    expect(res).not.toBeNull();
    expect((res!.data.folderIcons as Record<string, unknown>).projects).toBe("Folder");
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon bumps the version so the sidebar refetches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-icon-ver-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon rejects a path that escapes the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-icon-esc-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../escape", icon: "Folder" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility sets a directory visibility surfaced on GET /tree, cascading to its files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "private", visibility: "hidden" }),
    });
    expect(res.status).toBe(200);

    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "private", kind: "dir", visibility: "hidden", ownVisibility: "hidden" });
    expect(entries).toContainEqual({ path: "private/a.md", kind: "file", visibility: "hidden" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility with null visibility removes a previously-set directory visibility", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-clear-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (body: unknown) =>
    fetch(`${base}/folder-visibility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    await post({ path: "private", visibility: "hidden" });
    let entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "private", kind: "dir", visibility: "hidden", ownVisibility: "hidden" });

    await post({ path: "private", visibility: null });
    entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "private", kind: "dir" });
    expect(entries).toContainEqual({ path: "private/a.md", kind: "file" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility persists folderVisibility into settings.yaml", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-persist-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "private", visibility: "hidden" }),
    });
    const res = await readSettings(dir);
    expect(res).not.toBeNull();
    expect((res!.data.folderVisibility as Record<string, unknown>).private).toBe("hidden");
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility bumps the version so the sidebar refetches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-ver-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "private", visibility: "hidden" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility rejects a path that escapes the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-esc-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../escape", visibility: "hidden" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("POST /folder-visibility rejects a value outside the two-literal union", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-folder-visibility-badval-"));
  await writeNote(dir, "private/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "private", visibility: "all" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /tree: an explicit file-level visibility overrides an ancestor folder's setting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-visibility-override-"));
  await writeNote(dir, "private/a.md", "x");
  await writeNote(dir, "private/exposed.md", "---\nvisibility: all\n---\nx");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/folder-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "private", visibility: "hidden" }),
    });
    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "private/a.md", kind: "file", visibility: "hidden" });
    // The explicit "all" override means no visibility key at all (omitted, like icon).
    expect(entries).toContainEqual({ path: "private/exposed.md", kind: "file" });
  } finally {
    server.stop(true);
  }
});

test("GET /vault-data returns a row per note with file meta + frontmatter", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const rows = await (await fetch(`${base}/vault-data`)).json();
    expect(Array.isArray(rows)).toBe(true);
    const housing = rows.find((r: any) => r.file.name === "housing");
    expect(housing).toBeDefined();
    expect(housing.note.status).toBe("in-progress");
    expect(housing.file.tags).toContain("logistics");
  } finally {
    server.stop(true);
  }
});

test("PUT /file writes file and returns ok", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test-write.md", contents: "New content" })
    });
    const text = await res.text();
    expect(text).toBe("ok");
  } finally {
    server.stop(true);
  }
});

test("POST /backup schedules a coalesced snapshot", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/backup`, { method: "POST" });
    const data = await res.json();
    // Backups are now debounced/coalesced (not committed synchronously), so the route just
    // acknowledges it scheduled one.
    expect(data.scheduled).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /graph does not emit a synthetic self node", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const g = await (await fetch(`${base}/graph`)).json();
    expect(g.nodes.some((n: any) => n.id === "self")).toBe(false);
    expect(g.nodes.some((n: any) => n.kind === "self")).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("graph caching: second request returns same graph without rebuild", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const first = await (await fetch(`${base}/graph`)).json();
    const second = await (await fetch(`${base}/graph`)).json();
    expect(first.nodes.length).toBe(second.nodes.length);
    expect(first.edges.length).toBe(second.edges.length);
  } finally {
    server.stop(true);
  }
});

test("version increments are consistent", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v1 = await (await fetch(`${base}/version`)).json();
    const v2 = await (await fetch(`${base}/version`)).json();
    expect(v1.version).toBeLessThanOrEqual(v2.version);
  } finally {
    server.stop(true);
  }
});

test("config endpoint returns vault and memory paths", async () => {
  const server = createServer({ vault: "/custom/vault", memory: "/custom/memory", port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg.vault).toBe("/custom/vault");
    expect(cfg.memory).toBe("/custom/memory");
  } finally {
    server.stop(true);
  }
});

test("config endpoint handles undefined memory", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg.memory).toBeNull();
  } finally {
    server.stop(true);
  }
});

test("POST /create then /move then /delete then /restore round-trips a file", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post("/create", { path: "fresh.md", kind: "file" })).status).toBe(200);
    let paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("fresh.md");

    expect((await post("/move", { from: "fresh.md", to: "renamed.md" })).status).toBe(200);
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("renamed.md");
    expect(paths).not.toContain("fresh.md");

    const { trashPath } = await (await post("/delete", { path: "renamed.md" })).json();
    expect(typeof trashPath).toBe("string");
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).not.toContain("renamed.md");

    expect((await post("/restore", { trashPath, to: "renamed.md" })).status).toBe(200);
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("renamed.md");
  } finally {
    server.stop(true);
  }
});

test("POST /create returns 409 on collision", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "essay.md", kind: "file" }),
    });
    expect(res.status).toBe(409);
  } finally {
    server.stop(true);
  }
});

test("POST /set-property writes a frontmatter key reflected in /vault-data and /meta", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // housing.md starts at status: in-progress — flip it to done.
    const res = await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "housing.md", key: "status", value: "done" }),
    });
    expect(res.status).toBe(200);

    const rows = await (await fetch(`${base}/vault-data`)).json();
    const housing = rows.find((r: any) => r.file.name === "housing");
    expect(housing.note.status).toBe("done");
    // other keys are preserved
    expect(housing.note.priority).toBe(1);

    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta.status).toBe("done");
  } finally {
    server.stop(true);
  }
});

test("POST /set-property bumps the version so views refetch", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "essay.md", key: "status", value: "todo" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /set-property returns 404 for a path that doesn't exist (no silent create)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "no-such-note.md", key: "status", value: "todo" }),
    });
    expect(res.status).toBe(404);
    // The endpoint must NOT have created the file as a side effect.
    expect(await Bun.file(`${vault}/no-such-note.md`).exists()).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("POST /delete-property removes a frontmatter key, keeping the others", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/delete-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "housing.md", key: "priority" }),
    });
    expect(res.status).toBe(200);
    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta.priority).toBeUndefined();
    expect(meta.status).toBe("in-progress"); // siblings preserved
  } finally {
    server.stop(true);
  }
});

test("POST /delete-property drops the whole block when removing the last key (no empty fence)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await writeNote(vault, "iconned.md", "---\nicon: House\n---\n# Title\n\nbody\n");
    const res = await fetch(`${base}/delete-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "iconned.md", key: "icon" }),
    });
    expect(res.status).toBe(200);
    const raw = await readNote(vault, "iconned.md");
    expect(raw).toBe("# Title\n\nbody\n");
    expect(raw).not.toContain("---");
  } finally {
    server.stop(true);
  }
});

test("POST /move bumps the version so the sidebar refetches", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "essay.md", to: "essay2.md" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/decks returns decks with due counts", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-srs-srv-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-srs-mem-"));
  await writeNote(vault, "m.md", "#flashcards/math\n\n2+2::4");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const decks = await (await fetch(`${base}/cards/decks`)).json();
    expect(decks.find((d: any) => d.name === "math").due).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/due returns due cards; POST /cards/review schedules them", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-srs-srv2-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-srs-mem2-"));
  await writeNote(vault, "m.md", "#flashcards\n\n2+2::4");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const due = await (await fetch(`${base}/cards/due`)).json();
    expect(due.length).toBe(1);
    const id = due[0].id;
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, response: "good" }),
    });
    expect(res.ok).toBe(true);
    const text = await readNote(vault, "m.md");
    expect(text).toContain("<!--SR:");
  } finally {
    server.stop(true);
  }
});

test("GET /cards/all returns every card regardless of due date", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-srs-all-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-srs-all-mem-"));
  await writeNote(vault, "m.md", "#flashcards\n\na::b\n\nc::d <!--SR:!2099-01-01,5,250-->");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const all = await (await fetch(`${base}/cards/all`)).json();
    expect(all.length).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("POST /cards/review with an unknown card id returns 404", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-srs-bad-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-srs-bad-mem-"));
  await writeNote(vault, "m.md", "#flashcards\n\na::b");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "m.md::99::0", response: "good" }),
    });
    expect(res.status).toBe(404);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/note returns all cards for one note (tagless ok)", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-srs-note-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-srs-note-mem-"));
  await writeNote(vault, "n.md", "a::b\n\nc::d");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cards = await (await fetch(`${base}/cards/note?path=${encodeURIComponent("n.md")}`)).json();
    expect(cards.length).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("GET /events frame includes the changed path on mutation", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Prime — gets headers flushed so the SSE response actually starts streaming.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prime-paths.md", kind: "file" }),
    });
    const res = await fetch(`${base}/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Trigger another mutation we'll wait for.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "tracked-path.md", kind: "file" }),
    });

    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      // Walk frames; only look at data frames (skip heartbeat comments).
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        if (!f.startsWith("data: ")) continue;
        const payload = JSON.parse(f.slice(6));
        if (Array.isArray(payload.paths) && payload.paths.includes("tracked-path.md")) {
          expect(typeof payload.version).toBe("number");
          expect(payload.paths).toContain("tracked-path.md");
          await reader.cancel();
          return;
        }
      }
    }
    throw new Error(`no SSE frame mentioned tracked-path.md; buf=${buf}`);
  } finally {
    server.stop(true);
  }
});

import { initializeSettings } from "../src/settings";
import { rmSync, existsSync } from "node:fs";

test("GET /settings returns parsed app settings with defaults", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const s = await (await fetch(`${base}/settings`)).json();
    expect(s.appearance.theme).toBe("oxide-duotone");
    expect(s.graph.nodeSize).toBe(6);
    expect(s.properties).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test("GET /schema returns the property registry from settings.yaml", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, ".settings", "properties:\n  due: date\n  rating: number\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const schema = await (await fetch(`${base}/schema`)).json();
    expect(schema.due.type).toBe("date");
    expect(schema.rating.type).toBe("number");
  } finally {
    server.stop(true);
  }
});

test("createServer writes a settings.yaml on boot when missing", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  try {
    // initializeSettings is fire-and-forget on boot; allow the write to land.
    await initializeSettings(vault); // idempotent — ensures the file is present
    const exists = await Bun.file(join(vault, ".settings")).exists();
    expect(exists).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /file materializes settings.yaml from defaults when missing at read time", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Defeat the fire-and-forget boot init so the file is genuinely absent at the
    // moment of the read — the exact state a stale/never-booted server leaves behind.
    await initializeSettings(vault); // drain any pending boot write deterministically
    rmSync(join(vault, ".settings"));
    const res = await fetch(`${base}/file?path=.settings`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("appearance:"); // default content, not a blank editor
    expect(text).toContain("theme: oxide-duotone");
    expect(existsSync(join(vault, ".settings"))).toBe(true); // recreated on disk
  } finally {
    server.stop(true);
  }
});

test("editing settings.yaml refreshes GET /schema without restart", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, ".settings", "properties:\n  due: date\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const before = await (await fetch(`${base}/schema`)).json();
    expect(before.due.type).toBe("date");
    expect(before.rating).toBeUndefined();

    // Rewrite via PUT /file (the path the frontend uses) then poll the schema.
    await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".settings", contents: "properties:\n  rating: number\n" }),
    });

    const after = await (await fetch(`${base}/schema`)).json();
    expect(after.rating.type).toBe("number");
    expect(after.due).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test("GET /events streams a version event after a mutating call", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Prime the version counter so the server sends an immediate snapshot when the
    // SSE stream connects. Without this, Bun won't flush response headers until the
    // first enqueue — causing `await fetch('/events')` to hang.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prime.md", kind: "file" }),
    });

    const res = await fetch(`${base}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read until we see a data frame with a version number (the initial snapshot).
    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const m = buf.match(/data: (\{.*?\})\n\n/);
      if (m) {
        const payload = JSON.parse(m[1]);
        expect(typeof payload.version).toBe("number");
        expect(payload.version).toBeGreaterThan(0);
        await reader.cancel();
        return;
      }
    }
    throw new Error(`no SSE event received; buffer: ${buf}`);
  } finally {
    server.stop(true);
  }
});

test("GET /base returns config + rows for a type:base file", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: calendar\n---\n\n| title | date |\n| --- | --- |\n| X | 2026-06-01 |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/base?file=Cal.md`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.views[0].type).toBe("calendar");
    expect(data.rows[0].note.title).toBe("X");
    const missing = await fetch(`${base}/base?file=Nope.md`);
    expect(missing.status).toBe(404);
  } finally {
    server.stop(true);
  }
});

test("POST /row/update edits a base row and bumps version", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: table\n---\n\n| id | title |\n| --- | --- |\n| 1 | A |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    const res = await fetch(`${base}/row/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Cal.md", index: 0, note: { id: 1, title: "Z" } }),
    });
    expect(res.ok).toBe(true);
    const data = await (await fetch(`${base}/base?file=Cal.md`)).json();
    expect(data.rows[0].note.title).toBe("Z");
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /row/update appends a new row when index is null", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: table\n---\n\n| id | title |\n| --- | --- |\n| 1 | A |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/row/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Cal.md", index: null, note: { id: 2, title: "B" } }),
    });
    const data = await (await fetch(`${base}/base?file=Cal.md`)).json();
    expect(data.rows.length).toBe(2);
    expect(data.rows[1].note.title).toBe("B");
  } finally {
    server.stop(true);
  }
});

test("POST /cards/review (row-based) advances a flashcard base row", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Deck.md", "---\ntype: base\nview: flashcards\n---\n\n| front | back | due | ease | interval |\n| --- | --- | --- | --- | --- |\n| 2+2 | 4 |  | 250 | 0 |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Deck.md", index: 0, response: "good" }),
    });
    expect(res.ok).toBe(true);
    const data = await (await fetch(`${base}/base?file=Deck.md`)).json();
    expect(data.rows[0].note.interval).toBe(1);
    expect(typeof data.rows[0].note.due).toBe("string");
  } finally {
    server.stop(true);
  }
});

test("POST /rows resolves a scoped-tasks spec via base composition", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-rows-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-rows-mem-"));
  await writeNote(vault, "Keep.md", '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n');
  await writeNote(vault, "keep/x.md", "---\ntags: [keep]\n---\n- [ ] scoped task");
  await writeNote(vault, "other/y.md", "- [ ] unscoped task");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const rows = await (
      await fetch(`${base}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { kind: "tasks", from: "[[Keep]]" } }),
      })
    ).json();
    expect(rows.map((r: any) => r.note.description)).toEqual(["scoped task"]);
  } finally {
    server.stop(true);
  }
});

test("POST /rows notes source serves cached vault rows that a file edit invalidates", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-rows-cache-"));
  const memory = mkdtempSync(join(tmpdir(), "bismuth-rows-cache-mem-"));
  await writeNote(vault, "a.md", "---\ntags: [book]\n---\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  const resolveNotes = async () =>
    (await (
      await fetch(`${base}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { kind: "notes", where: 'file.hasTag("book")' } }),
      })
    ).json()) as any[];
  try {
    // Populate the shared cache via /vault-data, then resolve a notes spec — it filters
    // the cached array rather than rescanning, and only "a" carries the tag.
    await fetch(`${base}/vault-data`);
    expect((await resolveNotes()).map((r) => r.file.name)).toEqual(["a"]);
    // A new tagged note invalidates the cache; the next resolution rebuilds and sees it.
    await writeNote(vault, "b.md", "---\ntags: [book]\n---\n");
    await new Promise((r) => setTimeout(r, 400));
    expect((await resolveNotes()).map((r) => r.file.name).sort()).toEqual(["a", "b"]);
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting merges one key and preserves the rest of settings.yaml", async () => {
  const { vault } = await makeSampleVault();
  // Seed a settings.yaml with a comment + a custom key + the properties registry.
  await writeNote(vault, ".settings", "# my settings\nappearance:\n  theme: oxide-duotone\n  myCustom: 7\nproperties:\n  due: date\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-setting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ["appearance", "editorFont"], value: "Georgia" }),
    });
    expect(res.status).toBe(200);

    const settings = await (await fetch(`${base}/settings`)).json();
    expect(settings.appearance.editorFont).toBe("Georgia"); // changed key
    expect(settings.appearance.theme).toBe("oxide-duotone"); // reconciled default present

    const raw = await readNote(vault, ".settings");
    expect(raw).toContain("# my settings");                // comment preserved
    expect(raw).toContain("myCustom: 7");                  // unknown key preserved
    expect(raw).toContain("due: date");                    // properties registry preserved
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting rejects a non-array path with 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-setting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "appearance.theme", value: "light" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /templates lists .md files in the templates folder", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Templates/Daily.md", "# {{date}}\n");
  await writeNote(vault, "Templates/Meeting.md", "# Meeting\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const list = await (await fetch(`${base}/templates`)).json();
    const names = list.map((t: any) => t.name).sort();
    expect(names).toEqual(["Daily", "Meeting"]);
    expect(list.find((t: any) => t.name === "Daily").path).toBe("Templates/Daily.md");
  } finally {
    server.stop(true);
  }
});

test("GET /templates returns [] when the folder is absent", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const list = await (await fetch(`${base}/templates`)).json();
    expect(list).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("POST /daily-note creates today's note from the template, then reopens it without clobbering", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-daily-"));
  await writeNote(vault, ".settings", [
    "dailyNotes:",
    "  - id: journal",
    "    label: Journal",
    "    icon: BookOpen",
    "    folder: Journal",
    '    fileName: "{{date}} journal"',
    "    template: Templates/Journal.md",
  ].join("\n"));
  await writeNote(vault, "Templates/Journal.md", "# {{title}}\n\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  const call = (id: string) => fetch(`${base}/daily-note`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  try {
    const r1 = await (await call("journal")).json();
    expect(r1.created).toBe(true);
    expect(r1.path).toMatch(/^Journal\/\d{4}-\d{2}-\d{2} journal\.md$/);
    const titleBase = r1.path.replace(/^Journal\//, "").replace(/\.md$/, "");
    expect(await readNote(vault, r1.path)).toBe(`# ${titleBase}\n\n`);

    await writeNote(vault, r1.path, "my entry");      // user edits today's note
    const r2 = await (await call("journal")).json();  // pressing again must reopen, not clobber
    expect(r2).toEqual({ path: r1.path, created: false });
    expect(await readNote(vault, r1.path)).toBe("my entry");

    const r3 = await call("does-not-exist");           // unknown id → 400
    expect(r3.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("POST /daily-note bumps version only on create (SSE carries the new path), not on the no-op reopen", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-daily-version-"));
  await writeNote(vault, ".settings", [
    "dailyNotes:",
    "  - id: journal",
    "    label: Journal",
    "    folder: Journal",
    '    fileName: "{{date}} journal"',
  ].join("\n"));
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  const call = () => fetch(`${base}/daily-note`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "journal" }),
  });
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;

    // Open the SSE stream so we can capture the frame emitted by the create.
    const res = await fetch(`${base}/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First call CREATES the note → it broadcasts an SSE frame naming the new path and
    // bumps the version. We don't assert an exact delta: writing the note also triggers
    // the vault file-watcher, which invalidates again shortly after — B3's guarantee is
    // about the NO-OP reopen below, not the precise create delta.
    const r1 = await (await call()).json();
    expect(r1.created).toBe(true);

    let sawPath = false;
    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        if (!f.startsWith("data: ")) continue;
        const payload = JSON.parse(f.slice(6));
        if (Array.isArray(payload.paths) && payload.paths.includes(r1.path)) {
          sawPath = true;
          break;
        }
      }
      if (sawPath) break;
    }
    await reader.cancel();
    expect(sawPath).toBe(true);

    // Let any debounced file-watch invalidation from the create settle: wait until the
    // version is unchanged for 500ms straight, then take that as the stable baseline.
    const readVersion = async () => (await (await fetch(`${base}/version`)).json()).version;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let settled = await readVersion();
    let stableSince = Date.now();
    const settleStart = Date.now();
    while (Date.now() - settleStart < 3000) {
      await sleep(100);
      const next = await readVersion();
      if (next !== settled) { settled = next; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 500) break;
    }
    expect(settled).toBeGreaterThan(v0); // the create bumped the version

    // Second call is a no-op (note already exists) → it writes nothing, so it must NOT
    // invalidate / bump the version (the core of bugfix B3).
    const r2 = await (await call()).json();
    expect(r2.created).toBe(false);
    await sleep(400); // longer than the file-watch debounce — confirm no late bump
    expect(await readVersion()).toBe(settled);
  } finally {
    server.stop(true);
  }
});

test("GET /graph/views returns 2nd/3rd-brain view layouts", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const views = await fetch(`${base}/graph/views`).then((r) => r.json());
    expect(views).toHaveProperty("second");
    expect(views).toHaveProperty("third");
    expect(typeof views.second.pos3d).toBe("object");
    expect(typeof views.second.pos2d).toBe("object");
    expect(typeof views.third.pos3d).toBe("object");
    expect(typeof views.third.pos2d).toBe("object");
  } finally {
    server.stop(true);
  }
});

test("after /graph/views, /graph includes the view layouts", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/graph/views`).then((r) => r.json());
    const g = await fetch(`${base}/graph`).then((r) => r.json());
    expect(g.views).toBeDefined();
    expect(g.views.second).toBeDefined();
    expect(g.views.third).toBeDefined();
  } finally {
    server.stop(true);
  }
});

test("GET /graph is consistent across concurrent requests", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const [a, b] = await Promise.all([
      fetch(`${base}/graph`).then((r) => r.json()),
      fetch(`${base}/graph`).then((r) => r.json()),
    ]);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.edges.length).toBe(b.edges.length);
  } finally {
    server.stop(true);
  }
});

test("a structural mutation invalidates the cached /graph", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const before = await fetch(`${base}/graph`).then((r) => r.json());
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "brand-new-note-mutation-test.md", kind: "file" }),
    });
    const after = await fetch(`${base}/graph`).then((r) => r.json());
    expect(after.nodes.length).toBe(before.nodes.length + 1);
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting serializes concurrent requests without clobbering changes", async () => {
  const { vault } = await makeSampleVault();
  // Seed settings with multiple keys
  await writeNote(vault, ".settings", "appearance:\n  theme: oxide-duotone\n  editorFont: Lora\ngraph:\n  nodeSize: 5\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Fire 3 concurrent POST /set-setting requests that each modify a different key
    const requests = [
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["appearance", "theme"], value: "indigo-oxide" }),
      }),
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["appearance", "editorFont"], value: "Georgia" }),
      }),
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["graph", "nodeSize"], value: 10 }),
      }),
    ];

    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // Verify all three changes were persisted (none clobbered)
    const settings = await (await fetch(`${base}/settings`)).json();
    expect(settings.appearance.theme).toBe("indigo-oxide");
    expect(settings.appearance.editorFont).toBe("Georgia");
    expect(settings.graph.nodeSize).toBe(10);
  } finally {
    server.stop(true);
  }
});

test("daemon routes: status + devices read shared state, owner round-trips", async () => {
  const { vault, memory } = await makeSampleVault();
  // Point the daemon home at a tmp dir with fake state so the routes are deterministic.
  const home = mkdtempSync(join(tmpdir(), "claude-bot-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(home, "device-id"), "dev-a");
  writeFileSync(
    join(home, "devices.json"),
    JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
  );
  const prev = process.env.BISMUTH_DAEMON_DIR;
  process.env.BISMUTH_DAEMON_DIR = home;

  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const status = await (await fetch(`${base}/daemon/status`)).json();
    expect(status.running).toBe(false); // no daemon.pid written
    expect(status.thisDeviceId).toBe("dev-a");
    expect(status.owner).toBeNull(); // unclaimed

    const devices = await (await fetch(`${base}/daemon/devices`)).json();
    expect(devices.ownerDeviceId).toBeNull();
    expect(devices.devices.map((d: any) => d.deviceId).sort()).toEqual(["dev-a", "dev-b"]);

    // Claim dev-b as owner; the response + a follow-up read both reflect it.
    const claimed = await (
      await fetch(`${base}/daemon/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-b" }),
      })
    ).json();
    expect(claimed.ownerDeviceId).toBe("dev-b");
    expect(claimed.ownerLabel).toBe("desktop");
    expect(Object.keys(claimed).sort()).toEqual(["ownerDeviceId", "ownerLabel", "updatedAt"]);

    const after = await (await fetch(`${base}/daemon/status`)).json();
    expect(after.owner.ownerDeviceId).toBe("dev-b");

    // An unknown device is rejected with a 400.
    const bad = await fetch(`${base}/daemon/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "nope" }),
    });
    expect(bad.status).toBe(400);
  } finally {
    server.stop(true);
    if (prev === undefined) delete process.env.BISMUTH_DAEMON_DIR;
    else process.env.BISMUTH_DAEMON_DIR = prev;
  }
});

test("GET /daemon/install returns a never-throwing install status", async () => {
  // installStatus() degrades to a safe default whenever it can't talk to the
  // claude-bot installer entrypoint, so the route always answers with a valid
  // { installed, running } object (never 500) regardless of host state.
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/daemon/install`);
    expect(res.ok).toBe(true);
    const status = await res.json();
    expect(typeof status.installed).toBe("boolean");
    expect(typeof status.running).toBe("boolean");
  } finally {
    server.stop(true);
  }
});

test("POST /daemon/setup is a read-table system action (no vault mutation)", async () => {
  // Setup registers the bundled daemon service. Depending on whether the daemon binary is
  // installed at ~/.bismuth/bin in this environment, it returns a { ok, binPath, error? }
  // result (200) — but it must NOT 404 and must NOT bump the vault version (it is NOT a
  // mutatingHandler route).
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    const res = await fetch(`${base}/daemon/setup`, { method: "POST" });
    expect(res.status).not.toBe(404);
    if (res.ok) {
      const result = await res.json();
      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.binPath).toBe("string");
    }
    // Not a mutation: the vault version must be unchanged.
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBe(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /tasks/toggle sinks the completed task to the bottom of its block", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "todo.md", ["- [ ] a", "- [ ] b", "- [ ] c"].join("\n"));
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Complete the middle task (line 1) — it should drop below the still-open ones.
    await fetch(`${base}/tasks/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "todo.md", line: 1 }),
    });
    const after = await readNote(vault, "todo.md");
    expect(after.split("\n")).toEqual(["- [ ] a", "- [ ] c", "- [x] b ✅ " + after.match(/✅ (\d{4}-\d{2}-\d{2})/)![1]]);
  } finally {
    server.stop(true);
  }
});

test("POST /tasks/toggle preserves CRLF line endings", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "todo.md", ["- [ ] a", "- [ ] b", "- [ ] c"].join("\r\n"));
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/tasks/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "todo.md", line: 0 }),
    });
    const after = await readNote(vault, "todo.md");
    // CRLF round-trips (no \n-only joins) and the toggled line is clean (no stray \r).
    expect(after).not.toMatch(/(?<!\r)\n/);
    expect(after).toMatch(/- \[x\] a ✅ \d{4}-\d{2}-\d{2}/);
  } finally {
    server.stop(true);
  }
});

test("POST /tasks/archive removes resolved tasks from a single note", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "todo.md", ["- [ ] keep", "- [x] done", "- [-] cancelled"].join("\n"));
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await (await fetch(`${base}/tasks/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "todo.md" }),
    })).json();
    expect(res).toEqual({ removed: 2, files: 1 });
    expect(await readNote(vault, "todo.md")).toBe("- [ ] keep");
  } finally {
    server.stop(true);
  }
});

test("POST /tasks/archive with no path sweeps the whole vault", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "one.md", ["- [ ] keep", "- [x] done"].join("\n"));
  await writeNote(vault, "two.md", ["- [-] gone", "- [/] doing"].join("\n"));
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await (await fetch(`${base}/tasks/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })).json();
    expect(res.removed).toBe(2);
    expect(res.files).toBe(2);
    expect(await readNote(vault, "one.md")).toBe("- [ ] keep");
    expect(await readNote(vault, "two.md")).toBe("- [/] doing");
  } finally {
    server.stop(true);
  }
});
