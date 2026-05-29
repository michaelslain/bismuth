import { spawn as spawnPty } from "bun-pty";
import type { IPty } from "bun-pty";
import { randomUUID } from "node:crypto";

export interface Session {
  id: string;
  pty: IPty;
  cols: number;
  rows: number;
}

const sessions = new Map<string, Session>();

export function createTerminalSession(opts: {
  cwd: string;
  shell?: string;
  cols: number;
  rows: number;
}): Session {
  const shell = opts.shell ?? process.env.SHELL ?? "/bin/sh";
  const p = spawnPty(shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: Object.fromEntries(
      Object.entries({ ...process.env, TERM: "xterm-256color" })
        .filter((e): e is [string, string] => e[1] !== undefined),
    ),
  });
  const s: Session = { id: randomUUID(), pty: p, cols: opts.cols, rows: opts.rows };
  sessions.set(s.id, s);
  return s;
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.pty.kill(); } catch { /* already dead */ }
  sessions.delete(id);
}

export function sessionCount(): number {
  return sessions.size;
}

export function listSessionIds(): string[] {
  return Array.from(sessions.keys());
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  s.cols = cols;
  s.rows = rows;
  try { s.pty.resize(cols, rows); } catch { /* dead */ }
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}
