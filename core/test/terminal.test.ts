import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalSession, killSession, sessionCount, resizeSession } from "../src/terminal";

function tmp() {
  return mkdtempSync(join(tmpdir(), "oa-term-"));
}

test("createTerminalSession spawns a shell that echoes stdin to stdout", async () => {
  const cwd = tmp();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  try {
    const out: Buffer[] = [];
    s.pty.onData((d) => out.push(Buffer.from(d)));
    s.pty.write("echo hi-from-test\n");
    // Wait for the echo. Poll up to 2s.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (Buffer.concat(out).toString().includes("hi-from-test")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Buffer.concat(out).toString()).toContain("hi-from-test");
  } finally {
    killSession(s.id);
  }
});

test("resizeSession updates the PTY winsize", async () => {
  const cwd = tmp();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  try {
    resizeSession(s.id, 120, 40);
    expect(s.cols).toBe(120);
    expect(s.rows).toBe(40);
  } finally {
    killSession(s.id);
  }
});

test("killSession removes the session from the registry", () => {
  const cwd = tmp();
  const before = sessionCount();
  const s = createTerminalSession({ cwd, shell: "/bin/sh", cols: 80, rows: 24 });
  expect(sessionCount()).toBe(before + 1);
  killSession(s.id);
  expect(sessionCount()).toBe(before);
});
