#!/usr/bin/env bun
// SessionEnd hook: this terminal-tab Claude Code session is ending (the user quit
// Claude). Drop it from the agents graph NOW, instead of waiting for the whole
// terminal pane to close — otherwise an exited session lingers as a stale "idle"
// node for as long as the shell stays open. Payload carries session_id + a reason.
//
// `clear` / `compact` also fire SessionEnd, but Claude keeps running in this terminal
// (a fresh session registers immediately via SessionStart), so we must NOT drop the
// node for those — only real exits should clear it.
import { readHookInput, postRelay, terminalId, runHook } from "../lib/report.ts";

runHook(async () => {
  if (!terminalId()) return; // not launched from a Bismuth terminal tab
  const input = await readHookInput();
  if (!input.session_id) return;
  const reason = String(input.reason ?? "");
  if (reason === "clear" || reason === "compact") return; // session continues — keep the node
  await postRelay("/relay/session/end", { sessionId: input.session_id });
});
