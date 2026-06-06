#!/usr/bin/env bun
// UserPromptSubmit hook: keep this session "awake" in the agents graph while the user
// works. Posts a full register (not just a heartbeat) so a session whose SessionStart
// was missed or dropped — e.g. an out-of-order event — self-heals and still appears.
import { readHookInput, postRelay, terminalId, runHook } from "../lib/report.ts";

runHook(async () => {
  const tid = terminalId();
  if (!tid) return;
  const input = await readHookInput();
  if (!input.session_id) return;
  await postRelay("/relay/session", {
    sessionId: input.session_id,
    terminalId: tid,
    cwd: input.cwd ?? "",
  });
});
