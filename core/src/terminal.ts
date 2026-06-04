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

  // Build environment with TERM override, filtering out undefined values
  const env = Object.fromEntries(
    Object.entries({ ...process.env, TERM: "xterm-256color" }).filter(
      (e): e is [string, string] => e[1] !== undefined,
    ),
  );

  const pty = spawnPty(shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env,
  });

  const session: Session = { id: randomUUID(), pty, cols: opts.cols, rows: opts.rows };
  sessions.set(session.id, session);
  return session;
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
    // already dead
  }
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
  try {
    s.pty.resize(cols, rows);
  } catch {
    // dead
  }
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

// Kill all PTY children synchronously on process exit so orphaned shells don't
// outlive backend restarts (covers SIGTERM from the dev runner and hot-reload).
process.on("exit", () => {
  for (const id of listSessionIds()) {
    killSession(id);
  }
});
