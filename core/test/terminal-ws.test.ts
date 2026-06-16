import { test, expect } from "bun:test";
import { createServer } from "../src/server";
import { makeSampleVault } from "./helpers";
import { listSessionIds } from "../src/terminal";

// Connect a binary WebSocket to /terminal and wait for the first server-pushed bytes.
async function openWs(base: string): Promise<WebSocket> {
  const ws = new WebSocket(`${base}/terminal?cols=80&rows=24`);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
  });
  return ws;
}

function sendStdin(ws: WebSocket, text: string) {
  const bytes = new TextEncoder().encode(text);
  const frame = new Uint8Array(1 + bytes.length);
  frame[0] = 0x00;
  frame.set(bytes, 1);
  ws.send(frame);
}

function collect(ws: WebSocket, predicate: (s: string) => boolean, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = "";
    const t = setTimeout(() => reject(new Error(`timeout, got: ${JSON.stringify(acc)}`)), timeoutMs);
    ws.onmessage = (ev) => {
      acc += new TextDecoder().decode(new Uint8Array(ev.data as ArrayBuffer));
      if (predicate(acc)) {
        clearTimeout(t);
        resolve(acc);
      }
    };
  });
}

// Wait until the PTY has emitted its initial prompt so the shell is ready to
// accept input. Sending stdin before the shell is interactive races with shell
// startup (especially under load) and gets eaten — the source of past flakes.
async function waitForShellReady(ws: WebSocket, timeoutMs = 4000): Promise<void> {
  await collect(ws, (s) => s.length > 0, timeoutMs);
  // Brief settle so any in-flight startup writes (rc files, prompt theming) drain.
  await new Promise((r) => setTimeout(r, 150));
}

test("GET /terminal upgrades to ws and echoes stdin via the PTY", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const ws = await openWs(base);
    await waitForShellReady(ws);
    sendStdin(ws, "echo ws-hi-test\n");
    const got = await collect(ws, (s) => s.includes("ws-hi-test"));
    expect(got).toContain("ws-hi-test");
    ws.close();
  } finally {
    server.stop(true);
  }
}, 10000);

test("GET /terminal rejects out-of-range cols/rows with 400", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const r1 = await fetch(`${base}/terminal?cols=0&rows=24`);
    expect(r1.status).toBe(400);
    const r2 = await fetch(`${base}/terminal?cols=80&rows=9999`);
    expect(r2.status).toBe(400);
    const r3 = await fetch(`${base}/terminal?cols=abc&rows=24`);
    expect(r3.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("0x01 resize frame propagates to the PTY", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const ws = await openWs(base);
    // Wait for the shell to be interactive before resizing / sending commands.
    await waitForShellReady(ws);
    // Build resize frame: [0x01, cols_lo, cols_hi, rows_lo, rows_hi]
    const frame = new Uint8Array(5);
    frame[0] = 0x01;
    const view = new DataView(frame.buffer, 1, 4);
    view.setUint16(0, 132, true); // cols
    view.setUint16(2, 50, true);  // rows
    ws.send(frame);
    // Give the PTY a moment to apply the new winsize before querying it.
    await new Promise((r) => setTimeout(r, 100));
    // Ask the shell to report rows/cols. Retry a few times: the first command can
    // race with the shell finishing startup (rc files, prompt theming) under load and
    // get eaten, so re-send `stty size` until the new winsize (50 132) shows up.
    const seen = collect(ws, (s) => /\b50\s+132\b/.test(s), 8000);
    for (let i = 0; i < 8; i++) {
      sendStdin(ws, "stty size\n");
      const hit = await Promise.race([seen, new Promise((r) => setTimeout(() => r(null), 800))]);
      if (hit) break;
    }
    const got = await seen;
    expect(got).toMatch(/\b50\s+132\b/);
    ws.close();
  } finally {
    server.stop(true);
  }
}, 10000);

test("closing the websocket kills the session after the grace period", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const before = new Set(listSessionIds());
    const ws = await openWs(base);
    const mine = listSessionIds().filter((id) => !before.has(id));
    expect(mine.length).toBe(1);
    const sessionId = mine[0];
    ws.close();
    // Wait past the 3s grace period.
    await new Promise((r) => setTimeout(r, 3500));
    expect(listSessionIds()).not.toContain(sessionId);
  } finally {
    server.stop(true);
  }
}, 10000);

// Open a ws carrying a stable termId (the reattach key).
async function openWsTerm(base: string, termId: string): Promise<WebSocket> {
  const ws = new WebSocket(`${base}/terminal?cols=80&rows=24&termId=${encodeURIComponent(termId)}`);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
  });
  return ws;
}

test("reconnecting with the same termId reattaches to the live shell", async () => {
  // A grace window long enough that the abnormal-close path keeps the PTY alive to reattach.
  process.env.OA_TERMINAL_GRACE_MS = "8000";
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const termId = "::term:reattach-probe";
    const before = listSessionIds().length;
    const ws1 = await openWsTerm(base, termId);
    await waitForShellReady(ws1);
    // Mark the shell's state, then drop the connection ABNORMALLY (custom code != 1000)
    // so the backend keeps the PTY for the grace window instead of killing it.
    sendStdin(ws1, "REATTACH_MARKER=alive\n");
    await new Promise((r) => setTimeout(r, 200));
    ws1.close(4001, "simulated drop");
    await new Promise((r) => setTimeout(r, 200));

    // Reconnect with the SAME termId. A reattached shell emits nothing until prompted
    // (no fresh prompt), so accumulate all output and poll by re-sending the probe —
    // a fresh shell would echo an EMPTY value, the same PTY echoes [alive].
    const ws2 = await openWsTerm(base, termId);
    let acc = "";
    ws2.onmessage = (ev) => { acc += new TextDecoder().decode(new Uint8Array(ev.data as ArrayBuffer)); };
    let ok = false;
    for (let i = 0; i < 16 && !ok; i++) {
      sendStdin(ws2, 'echo "RM[$REATTACH_MARKER]"\n');
      await new Promise((r) => setTimeout(r, 400));
      if (/RM\[alive\]/.test(acc)) ok = true;
    }
    expect(ok).toBe(true);
    // Reattach reused the session — it didn't spawn a second one.
    expect(listSessionIds().length).toBe(before + 1);
    ws2.close(1000);
  } finally {
    server.stop(true);
    delete process.env.OA_TERMINAL_GRACE_MS;
  }
}, 15000);

test("a clean close (1000) kills immediately; an abnormal close waits the grace window", async () => {
  process.env.OA_TERMINAL_GRACE_MS = "600";
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    // Clean close → gone promptly (no grace).
    let before = new Set(listSessionIds());
    const wsClean = await openWsTerm(base, "::term:clean");
    const cleanId = listSessionIds().filter((id) => !before.has(id))[0];
    wsClean.close(1000, "dispose");
    await new Promise((r) => setTimeout(r, 250));
    expect(listSessionIds()).not.toContain(cleanId);

    // Abnormal close → still alive right after, reaped only once the grace elapses.
    before = new Set(listSessionIds());
    const wsDrop = await openWsTerm(base, "::term:drop");
    const dropId = listSessionIds().filter((id) => !before.has(id))[0];
    wsDrop.close(4002, "drop");
    await new Promise((r) => setTimeout(r, 200));
    expect(listSessionIds()).toContain(dropId); // within grace
    await new Promise((r) => setTimeout(r, 700));
    expect(listSessionIds()).not.toContain(dropId); // past grace
  } finally {
    server.stop(true);
    delete process.env.OA_TERMINAL_GRACE_MS;
  }
}, 10000);

test("shell exit closes the websocket with code 1000 (so the client closes the tab, not respawns)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const ws = await openWs(base);
    await waitForShellReady(ws);
    const code = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("shell did not exit")), 5000);
      ws.onclose = (e) => { clearTimeout(t); resolve(e.code); };
      sendStdin(ws, "exit\n");
    });
    expect(code).toBe(1000);
  } finally {
    server.stop(true);
  }
}, 8000);
