import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";
import { mintOwnerToken, resolveRequestChannel, ownerTokenDenyPath, ownerTokenDenyPaths } from "../src/ownerToken";
import { readRunRecords, runRecordPath, runKey } from "../src/runRegistry";
import { buildDenyPaths } from "../src/visibility";
import { buildChatSandboxOption } from "../src/chat";
import { makeVault, makeSampleVault } from "./helpers";
import {
  ownerTokenDenyPath as daemonOwnerTokenDenyPath,
  ownerTokenDenyPaths as daemonOwnerTokenDenyPaths,
} from "../../daemon/src/lib/bismuthPaths.ts";

// Isolate the run registry for this whole file: writeRunRecord/readRunRecords must never touch
// the real ~/.bismuth/run while these tests boot throwaway servers (mirrors the module-scope
// BISMUTH_DAEMON_DIR isolation at the top of server.test.ts).
process.env.BISMUTH_RUN_DIR = mkdtempSync(join(tmpdir(), "bismuth-ownertoken-run-"));

/** This boot's owner token, read back off the run record `createServer` just wrote (synchronous
 *  — writeRunRecord runs before createServer returns, so no race/poll is needed). */
function tokenFor(vault: string): string {
  const rec = readRunRecords().find((r) => r.vault === vault);
  if (!rec?.token) throw new Error(`no run record/token found for ${vault}`);
  return rec.token;
}

// ---- resolveRequestChannel — PURE, table-driven -----------------------------------------------

test("resolveRequestChannel: a matching X-Bismuth-Token is the owner, unconditionally", () => {
  const headers = new Headers({ "X-Bismuth-Token": "secret123" });
  expect(resolveRequestChannel(headers, "secret123")).toBe("owner");
});

test("resolveRequestChannel: a mismatched token falls through to the channel header", () => {
  const headers = new Headers({ "X-Bismuth-Token": "wrong-token", "X-Bismuth-Channel": "chat" });
  expect(resolveRequestChannel(headers, "secret123")).toBe("chat");
});

test("resolveRequestChannel: no headers at all defaults to daemon — the stricter tier", () => {
  expect(resolveRequestChannel(new Headers(), "secret123")).toBe("daemon");
});

test("resolveRequestChannel: X-Bismuth-Channel: chat is honored without a token", () => {
  const headers = new Headers({ "X-Bismuth-Channel": "chat" });
  expect(resolveRequestChannel(headers, "secret123")).toBe("chat");
});

test("resolveRequestChannel: an unrecognized channel value defaults to daemon, never chat", () => {
  const headers = new Headers({ "X-Bismuth-Channel": "bogus-value" });
  expect(resolveRequestChannel(headers, "secret123")).toBe("daemon");
});

test("resolveRequestChannel: an empty server token can never match — fails closed, not open", () => {
  // A misconfigured boot (should never happen — server.ts always mints one via mintOwnerToken)
  // must still fail CLOSED: an empty token is falsy, so it can never grant "owner", not even to
  // an equally-empty presented header.
  const headers = new Headers({ "X-Bismuth-Token": "" });
  expect(resolveRequestChannel(headers, "")).toBe("daemon");
});

test("mintOwnerToken: a long random hex string, different every call", () => {
  const a = mintOwnerToken();
  const b = mintOwnerToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test("ownerTokenDenyPath names the exact run-record file every channel's deny plan must cover", () => {
  const vault = "/tmp/some-vault-path";
  expect(ownerTokenDenyPath(vault)).toBe(runRecordPath(vault));
});

// ---- CORS preflight: the browser must be ALLOWED TO SEND X-Bismuth-Token in the first place ----
//
// Every test below this point drives the server with Bun's `fetch`, which never enforces CORS —
// it will happily deliver a header the browser would have refused to send. That is exactly why a
// prior version of this file could pass in full while every real browser request carrying
// X-Bismuth-Token was silently blocked at the preflight: nothing here ever asked the server what
// its PREFLIGHT response actually promises. A browser decides whether to send the real request at
// all by parsing the OPTIONS response's Access-Control-Allow-Headers — so that is the exact value
// this test pins, independent of whether the follow-up request would have been accepted.
test("OPTIONS preflight for X-Bismuth-Token: Access-Control-Allow-Headers must name it, or the browser refuses to ever send the real request", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file?path=whatever.md`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:1420",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Bismuth-Token",
      },
    });
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    expect(allowed).toContain("x-bismuth-token");
  } finally {
    server.stop(true);
  }
});

// ---- HTTP routes: the tokenless request is refused/filtered, the tokenful one is not ----------

test("T-H1: GET /file — a hidden note 403s without the token and never leaks its body; 200 with the token; a visible note stays 200 either way", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\nTOKEN-OWNERTOKEN-SECRET-1\n",
    "public.md": "# Public\nnothing sensitive here\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);

    const noTokenHidden = await fetch(`${base}/file?path=secret.md`);
    expect(noTokenHidden.status).toBe(403);
    expect(await noTokenHidden.text()).not.toContain("TOKEN-OWNERTOKEN-SECRET-1");

    const withTokenHidden = await fetch(`${base}/file?path=secret.md`, { headers: { "X-Bismuth-Token": token } });
    expect(withTokenHidden.status).toBe(200);
    expect(await withTokenHidden.text()).toContain("TOKEN-OWNERTOKEN-SECRET-1");

    const noTokenPublic = await fetch(`${base}/file?path=public.md`);
    expect(noTokenPublic.status).toBe(200);
    expect(await noTokenPublic.text()).toContain("Public");
  } finally {
    server.stop(true);
  }
});

test("T-H2: POST /search omits a hidden note's hits without the token, includes them with it", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\nTOKEN-SEARCH-ONLY-IN-HIDDEN\n",
    "public.md": "nothing interesting in here\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  const search = async (headers?: Record<string, string>): Promise<Array<{ path: string }>> =>
    (await fetch(`${base}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ query: "TOKEN-SEARCH-ONLY-IN-HIDDEN", opts: { caseSensitive: false, wholeWord: false, regex: false } }),
    }).then((r) => r.json())) as Array<{ path: string }>;
  try {
    const token = tokenFor(vault);
    expect(await search()).toEqual([]);
    const withToken = await search({ "X-Bismuth-Token": token });
    expect(withToken.map((r) => r.path)).toEqual(["secret.md"]);
  } finally {
    server.stop(true);
  }
});

test("T-H3: POST /rows omits a hidden note's row without the token, includes it with it", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\ntags: [x]\n---\n",
    "public.md": "---\ntags: [x]\n---\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  const rows = async (headers?: Record<string, string>): Promise<Array<{ file: { path: string } }>> =>
    (await fetch(`${base}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ spec: { kind: "notes" } }),
    }).then((r) => r.json())) as Array<{ file: { path: string } }>;
  try {
    const token = tokenFor(vault);
    const noToken = await rows();
    expect(noToken.map((r) => r.file.path).sort()).toEqual(["public.md"]);
    const withToken = await rows({ "X-Bismuth-Token": token });
    expect(withToken.map((r) => r.file.path).sort()).toEqual(["public.md", "secret.md"]);
  } finally {
    server.stop(true);
  }
});

test("GET /vault-data mirrors POST /rows' filtering (same underlying feed)", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\n",
    "public.md": "",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    const noToken = (await (await fetch(`${base}/vault-data`)).json()) as Array<{ file: { path: string } }>;
    expect(noToken.map((r) => r.file.path)).toEqual(["public.md"]);
    const withToken = (await (
      await fetch(`${base}/vault-data`, { headers: { "X-Bismuth-Token": token } })
    ).json()) as Array<{ file: { path: string } }>;
    expect(withToken.map((r) => r.file.path).sort()).toEqual(["public.md", "secret.md"]);
  } finally {
    server.stop(true);
  }
});

test("GET /graph drops a hidden note's node (and every edge touching it) without the token", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\nlinks to [[public]]\n",
    "public.md": "# Public\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    const noToken = (await (await fetch(`${base}/graph`)).json()) as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
    const noTokenIds = noToken.nodes.map((n) => n.id);
    expect(noTokenIds).not.toContain("secret");
    expect(noTokenIds).toContain("public");
    expect(noToken.edges.some((e) => e.from === "secret" || e.to === "secret")).toBe(false);

    const withToken = (await (
      await fetch(`${base}/graph`, { headers: { "X-Bismuth-Token": token } })
    ).json()) as { nodes: Array<{ id: string }> };
    expect(withToken.nodes.map((n) => n.id)).toContain("secret");
  } finally {
    server.stop(true);
  }
});

test("GET /tasks omits a hidden note's task line without the token", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\n---\n- [ ] secret todo\n",
    "public.md": "- [ ] public todo\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    const noToken = (await (await fetch(`${base}/tasks`)).json()) as Array<{ path: string }>;
    expect(noToken.map((t) => t.path)).toEqual(["public.md"]);
    const withToken = (await (
      await fetch(`${base}/tasks`, { headers: { "X-Bismuth-Token": token } })
    ).json()) as Array<{ path: string }>;
    expect(withToken.map((t) => t.path).sort()).toEqual(["public.md", "secret.md"]);
  } finally {
    server.stop(true);
  }
});

test("GET /base and GET /meta 403 a hidden note without the token, 200 with it", async () => {
  const vault = makeVault({
    "secret.md": "---\nvisibility: hidden\nstatus: classified\n---\nbody\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    expect((await fetch(`${base}/base?file=secret.md`)).status).toBe(403);
    expect((await fetch(`${base}/base?file=secret.md`, { headers: { "X-Bismuth-Token": token } })).status).toBe(200);

    expect((await fetch(`${base}/meta?path=secret.md`)).status).toBe(403);
    const withToken = await fetch(`${base}/meta?path=secret.md`, { headers: { "X-Bismuth-Token": token } });
    expect(withToken.status).toBe(200);
    expect(await withToken.json()).toMatchObject({ status: "classified" });
  } finally {
    server.stop(true);
  }
});

test("GET /abs-path 403s a hidden note without the token, 200 with it", async () => {
  const vault = makeVault({ "secret.md": "---\nvisibility: hidden\n---\n" });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    expect((await fetch(`${base}/abs-path?path=secret.md`)).status).toBe(403);
    expect((await fetch(`${base}/abs-path?path=secret.md`, { headers: { "X-Bismuth-Token": token } })).status).toBe(200);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/note 403s a hidden note without the token, 200 with it", async () => {
  const vault = makeVault({ "secret.md": "---\nvisibility: hidden\n---\n?- what is the secret\n?- the secret\n" });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);
    expect((await fetch(`${base}/cards/note?path=secret.md`)).status).toBe(403);
    expect((await fetch(`${base}/cards/note?path=secret.md`, { headers: { "X-Bismuth-Token": token } })).status).toBe(200);
  } finally {
    server.stop(true);
  }
});

test("T-H4: X-Bismuth-Channel absent defaults to the daemon (stricter) filter, not chat", async () => {
  const vault = makeVault({
    "chatOnly.md": "---\nvisibility: chat-only\n---\nTOKEN-CHATONLY-VISIBLE-TO-CHAT\n",
  });
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // No channel header at all -> defaults to daemon -> a chat-only note is NOT visible to it.
    const noHeader = await fetch(`${base}/file?path=chatOnly.md`);
    expect(noHeader.status).toBe(403);
    // An explicit chat channel -> a chat-only note IS visible to chat (that's the tier's whole
    // point — see visibility.ts's isVisibleToChat).
    const chatHeader = await fetch(`${base}/file?path=chatOnly.md`, { headers: { "X-Bismuth-Channel": "chat" } });
    expect(chatHeader.status).toBe(200);
    expect(await chatHeader.text()).toContain("TOKEN-CHATONLY-VISIBLE-TO-CHAT");
  } finally {
    server.stop(true);
  }
});

test("harmless routes stay tokenless — no auth requirement leaks onto non-content-returning routes", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    expect((await fetch(`${base}/version`)).status).toBe(200);
    expect((await fetch(`${base}/terminal/info`)).status).toBe(200);
    expect((await fetch(`${base}/tree`)).status).toBe(200);
    expect((await fetch(`${base}/config`)).status).toBe(200);
    expect((await fetch(`${base}/settings`)).status).toBe(200);
    expect((await fetch(`${base}/schema`)).status).toBe(200);
  } finally {
    server.stop(true);
  }
});

test("GET /chat/sessions, GET /chat/session-messages, POST /chat/search are owner-only (blanket, not per-path)", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const token = tokenFor(vault);

    expect((await fetch(`${base}/chat/sessions`)).status).toBe(403);
    expect((await fetch(`${base}/chat/sessions`, { headers: { "X-Bismuth-Token": token } })).status).toBe(200);

    expect((await fetch(`${base}/chat/session-messages?id=nonexistent`)).status).toBe(403);
    expect(
      (await fetch(`${base}/chat/session-messages?id=nonexistent`, { headers: { "X-Bismuth-Token": token } })).status,
    ).toBe(200);

    const searchReq = (headers?: Record<string, string>) =>
      fetch(`${base}/chat/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ query: "hi" }),
      });
    expect((await searchReq()).status).toBe(403);
    expect((await searchReq({ "X-Bismuth-Token": token })).status).toBe(200);
  } finally {
    server.stop(true);
  }
});

// ---- The token file vs. the OS sandbox the Claude paths actually spawn under -------------------
//
// Everything above proves the HTTP gate refuses a tokenless caller. This proves the other half:
// that an agent inside a restricted session cannot simply GO GET the token. The two are one
// boundary — a deny list that omits the run record leaves the HTTP gate answering "owner" to the
// very process it is meant to filter.
//
// The probe is a real Seatbelt spawn, no agent and no vendor call. It is representative of the
// Claude paths' own sandbox, not merely of Bismuth's opencode wrapper: Claude Code 2.1.220
// (/Users/…/.local/share/claude/versions/2.1.220) spawns Bash tool calls as
// `env … /usr/bin/sandbox-exec -p <profile> <shell> -c <cmd>` and compiles each
// `sandbox.filesystem.denyRead` entry to `(deny file-read* (subpath "<abs>") (with message …))`
// under a leading `(allow file-read*)` — the same primitive, on the same absolute paths, with no
// cwd scoping. CLAUDE_PROFILE below reproduces that shape verbatim so this test fails for the same
// reason a live session would.
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const CAN_SANDBOX = process.platform === "darwin" && existsSync(SANDBOX_EXEC);

/** Claude Code 2.1.220's own read-deny profile shape, reproduced for the probe. */
function claudeShapedProfile(denyRead: string[]): string {
  const lines = ["(version 1)", "(allow default)", "(allow file-read*)"];
  for (const p of denyRead) lines.push("(deny file-read*", `  (subpath ${JSON.stringify(p)})`, '  (with message "visibility"))');
  return `${lines.join("\n")}\n`;
}

function readUnderProfile(profile: string, file: string): { out: string; code: number | null } {
  const dir = mkdtempSync(join(tmpdir(), "bismuth-ownertoken-sb-"));
  const sb = join(dir, "p.sb");
  writeFileSync(sb, profile);
  const r = Bun.spawnSync([SANDBOX_EXEC, "-f", sb, "/bin/cat", file], { stdout: "pipe", stderr: "pipe" });
  return { out: new TextDecoder().decode(r.stdout), code: r.exitCode };
}

test.skipIf(!CAN_SANDBOX)(
  "a chat session's own sandbox profile makes the owner-token run record UNREADABLE — the token never reaches a Bash `cat`",
  async () => {
    const vault = makeVault({
      "secret.md": "---\nvisibility: hidden\n---\nTOKEN-SEATBELT-HIDDEN-BODY\n",
      "public.md": "a visible note\n",
    });
    const server = createServer({ vault, port: 0 });
    try {
      const token = tokenFor(vault);
      const record = runRecordPath(vault);

      // Control 1 — the probe can SEE a successful read. The record is mode 0600 and owned by this
      // uid, which is the agent's uid too: unsandboxed, the token is simply there for the taking.
      expect(readFileSync(record, "utf8")).toContain(token);

      const entries = await buildDenyPaths(vault, "chat");
      expect(entries.length).toBeGreaterThan(0);
      const denyRead = (buildChatSandboxOption(entries, vault)?.filesystem as { denyRead?: string[] } | undefined)?.denyRead ?? [];

      const attack = readUnderProfile(claudeShapedProfile(denyRead), record);
      expect(attack.out).not.toContain(token);
      expect(attack.code).not.toBe(0);

      // Control 2 — the same profile is not simply denying everything: a VISIBLE note still reads,
      // so the failure above is the token deny and not a broken profile.
      const visible = readUnderProfile(claudeShapedProfile(denyRead), join(vault, "public.md"));
      expect(visible.out).toContain("a visible note");
      expect(visible.code).toBe(0);
    } finally {
      server.stop(true);
    }
  },
);

// A deny path that names the record through a symlink does not deny it — Seatbelt resolves links
// before matching, so the raw spelling is a silent no-op (verified directly against sandbox-exec:
// the same file, denied by its `/var/…` spelling, still `cat`s; denied by its `/private/var/…`
// spelling, it does not). ownerTokenDenyPaths therefore emits the canonical form alongside the raw
// one, exactly as DenyEntry.aliases does for vault files.
test("ownerTokenDenyPaths emits the canonical spelling when the run dir is reached through a symlink", () => {
  const real = mkdtempSync(join(tmpdir(), "bismuth-run-real-"));
  const link = join(mkdtempSync(join(tmpdir(), "bismuth-run-link-")), "runlink");
  symlinkSync(real, link);
  const saved = process.env.BISMUTH_RUN_DIR;
  process.env.BISMUTH_RUN_DIR = link;
  try {
    const paths = ownerTokenDenyPaths("/some/vault");
    const viaLink = join(link, `${runKey("/some/vault")}.json`);
    const viaReal = join(realpathSync(real), `${runKey("/some/vault")}.json`);
    expect(viaLink).not.toBe(viaReal); // the fixture is only meaningful if the two spellings differ
    expect(paths).toContain(viaReal);
    expect(paths).toContain(viaLink);
  } finally {
    if (saved === undefined) delete process.env.BISMUTH_RUN_DIR;
    else process.env.BISMUTH_RUN_DIR = saved;
  }
});

test("ownerTokenDenyPaths collapses to the single path when no link is involved", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bismuth-run-plain-")));
  const saved = process.env.BISMUTH_RUN_DIR;
  process.env.BISMUTH_RUN_DIR = dir;
  try {
    expect(ownerTokenDenyPaths("/some/vault")).toEqual([join(dir, `${runKey("/some/vault")}.json`)]);
  } finally {
    if (saved === undefined) delete process.env.BISMUTH_RUN_DIR;
    else process.env.BISMUTH_RUN_DIR = saved;
  }
});

// ---- Cross-workspace parity: the daemon's ported copy must name the SAME file ------------------
//
// The daemon is a separate workspace and a separately-bundled binary with no dependency on
// @bismuth/core, so its deny list computes the run-record path from its own copy of this logic
// (daemon/src/lib/bismuthPaths.ts). Two implementations that must agree is exactly the shape of
// defect this branch has already been bitten by once. If they drift, the daemon's sandbox denies a
// path no process ever opens and the token stays readable — with every unit test on both sides
// still green, because each would be asserting against its own spelling. This is the assertion that
// cannot be satisfied by drift.
test("the daemon's ported ownerTokenDenyPath resolves byte-identically to core's, for every vault-path shape", () => {
  for (const vault of [
    "/Users/x/vault",
    "/Users/x/vault with spaces",
    "/Users/x/vault/trailing/",
    "/Users/x/váult-nfc-é",
    "/private/var/folders/ab/cd/T/bismuth-vault-XyZ",
    "/",
  ]) {
    expect(daemonOwnerTokenDenyPath(vault)).toBe(ownerTokenDenyPath(vault));
  }
});

test("the daemon's ported copy honours BISMUTH_RUN_DIR the same way core's does — including the canonical-spelling expansion", () => {
  const real = mkdtempSync(join(tmpdir(), "bismuth-parity-real-"));
  const link = join(mkdtempSync(join(tmpdir(), "bismuth-parity-link-")), "runlink");
  symlinkSync(real, link);
  const saved = process.env.BISMUTH_RUN_DIR;
  try {
    process.env.BISMUTH_RUN_DIR = link;
    expect(daemonOwnerTokenDenyPaths("/Users/x/vault")).toEqual(ownerTokenDenyPaths("/Users/x/vault"));
    expect(ownerTokenDenyPaths("/Users/x/vault").length).toBe(2); // the fixture must actually exercise the link branch
    process.env.BISMUTH_RUN_DIR = realpathSync(real);
    expect(daemonOwnerTokenDenyPaths("/Users/x/vault")).toEqual(ownerTokenDenyPaths("/Users/x/vault"));
  } finally {
    if (saved === undefined) delete process.env.BISMUTH_RUN_DIR;
    else process.env.BISMUTH_RUN_DIR = saved;
  }
});
