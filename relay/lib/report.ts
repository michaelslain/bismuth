// Reporting helpers for the Bismuth agent-graph hooks. Each hook reads its payload
// from stdin and posts to the in-app relay (the core server) at CLAUDE_RELAY_URL.
//
// Two invariants: (1) hooks NEVER block or fail the user's session — every error is
// swallowed and we always exit 0 within a tight budget; (2) hooks only act for
// sessions launched from a Bismuth terminal tab, identified by CLAUDE_TERMINAL_ID
// (injected into the pty env by core/src/terminal.ts). The plugin is loaded
// per-session via `claude --plugin-dir <relay>` so it isn't even present outside app
// terminals, but the env gate is a cheap belt-and-suspenders guard.

const BUDGET_MS = 2000;

/** Subset of the Claude Code hook stdin payload we consume (see relay-merge-spec). */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  /** SessionEnd: why the session ended (e.g. "clear", "compact", "logout", "exit"). */
  reason?: string;
  [k: string]: unknown;
}

/** The app terminal-tab id, or undefined when not launched from a Bismuth terminal. */
export function terminalId(): string | undefined {
  return process.env.CLAUDE_TERMINAL_ID;
}

/** Base URL of this app's core server (set in the pty env by terminal.ts). */
export function relayUrl(): string {
  return process.env.CLAUDE_RELAY_URL || "http://localhost:4321";
}

/** Parse the hook payload from stdin; {} on empty/invalid input. */
export async function readHookInput(): Promise<HookInput> {
  try {
    const text = await Bun.stdin.text();
    return text ? (JSON.parse(text) as HookInput) : {};
  } catch {
    return {};
  }
}

/** POST to a relay endpoint, best-effort: 2s timeout, all errors swallowed. */
export async function postRelay(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${relayUrl().replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BUDGET_MS),
    });
  } catch {
    // relay unreachable / slow — never block the session.
  }
}

/** Run a hook body so it always exits 0 and never throws past the runtime. */
export function runHook(fn: () => Promise<void>): void {
  fn()
    .catch(() => {})
    .finally(() => process.exit(0));
}

/**
 * Register this terminal-tab session as a root node in the agents graph by posting
 * to /relay/session. Shared by the SessionStart and UserPromptSubmit hooks (both do
 * the same gate→read→guard→post a full register). No-ops when not launched from a
 * Bismuth terminal tab or when the payload carries no session id.
 */
export async function reportSession(): Promise<void> {
  const tid = terminalId();
  if (!tid) return; // not launched from a Bismuth terminal tab
  const input = await readHookInput();
  if (!input.session_id) return;
  await postRelay("/relay/session", {
    sessionId: input.session_id,
    terminalId: tid,
    cwd: input.cwd ?? "",
  });
}
