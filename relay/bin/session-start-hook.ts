#!/usr/bin/env bun
// SessionStart hook: register this terminal-tab Claude Code session with the in-app
// relay so it appears as a root node in the agents graph.
import { readHookInput, postRelay, terminalId, runHook } from "../lib/report.ts";

runHook(async () => {
  const tid = terminalId();
  if (!tid) return; // not launched from a Bismuth terminal tab
  const input = await readHookInput();
  if (!input.session_id) return;
  await postRelay("/relay/session", {
    sessionId: input.session_id,
    terminalId: tid,
    cwd: input.cwd ?? "",
  });
});
