import { test, expect } from "bun:test";
import { createServer } from "../src/server";
import { makeSampleVault } from "./helpers";
import { sessionCount } from "../src/terminal";

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

function collect(ws: WebSocket, predicate: (s: string) => boolean, timeoutMs = 2000): Promise<string> {
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

test("GET /terminal upgrades to ws and echoes stdin via the PTY", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const ws = await openWs(base);
    sendStdin(ws, "echo ws-hi-test\n");
    const got = await collect(ws, (s) => s.includes("ws-hi-test"));
    expect(got).toContain("ws-hi-test");
    ws.close();
  } finally {
    server.stop(true);
  }
});

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
    // Build resize frame: [0x01, cols_lo, cols_hi, rows_lo, rows_hi]
    const frame = new Uint8Array(5);
    frame[0] = 0x01;
    const view = new DataView(frame.buffer, 1, 4);
    view.setUint16(0, 132, true); // cols
    view.setUint16(2, 50, true);  // rows
    ws.send(frame);
    // Ask the shell to report COLUMNS/LINES.
    sendStdin(ws, "stty size\n");
    const got = await collect(ws, (s) => /\b50\s+132\b/.test(s));
    expect(got).toMatch(/\b50\s+132\b/);
    ws.close();
  } finally {
    server.stop(true);
  }
});

test("closing the websocket kills the session after the grace period", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `ws://localhost:${server.port}`;
  try {
    const ws = await openWs(base);
    const afterOpen = sessionCount();
    expect(afterOpen).toBeGreaterThanOrEqual(1);
    ws.close();
    // Wait past the 3s grace period.
    await new Promise((r) => setTimeout(r, 3500));
    // After the grace period, the session we opened (and any other lingering
    // sessions from prior tests) should be cleaned up — count strictly less.
    expect(sessionCount()).toBeLessThan(afterOpen);
  } finally {
    server.stop(true);
  }
}, 10000);
