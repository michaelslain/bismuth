import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";
import { mintOwnerToken, resolveRequestChannel, ownerTokenDenyPath } from "../src/ownerToken";
import { readRunRecords, runRecordPath } from "../src/runRegistry";
import { makeVault, makeSampleVault } from "./helpers";

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
