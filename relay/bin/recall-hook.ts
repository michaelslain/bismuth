#!/usr/bin/env bun
// UserPromptSubmit hook, two best-effort jobs run concurrently:
//   1. Keep this session "awake" in the agents graph (a full register, so a session whose
//      SessionStart was missed/dropped self-heals and still appears).
//   2. When the daemon is enabled for this vault (BISMUTH_MEMORY_DIR set), recall memory
//      relevant to the prompt and inject it as `additionalContext`. This is the per-session,
//      vault-scoped replacement for claude-bot's old global ~/.claude recall hook.
import { readHookInput, postRelay, terminalId, memoryDir, runHook } from "../lib/report.ts";
import { recallContext } from "../lib/memory.ts";

runHook(async () => {
  const tid = terminalId();
  if (!tid) return; // not launched from a Bismuth terminal tab
  const input = await readHookInput();
  const dir = memoryDir();

  // Heartbeat + recall in parallel so recall never serializes behind the POST (both are
  // budgeted: postRelay 2s, recallContext 800ms — recall must not stall prompt submission).
  const [, context] = await Promise.all([
    input.session_id
      ? postRelay("/relay/session", { sessionId: input.session_id, terminalId: tid, cwd: input.cwd ?? "" })
      : Promise.resolve(),
    dir && typeof input.prompt === "string" ? recallContext(dir, input.prompt) : Promise.resolve(null),
  ]);

  if (context) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }));
  }
});
