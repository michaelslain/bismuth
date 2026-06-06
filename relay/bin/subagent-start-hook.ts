#!/usr/bin/env bun
// SubagentStart hook: a subagent was spawned by this session's Agent tool. Add it as
// a child node hanging off the spawning session. Payload carries the parent
// session_id plus the subagent's stable agent_id + agent_type.
import { readHookInput, postRelay, terminalId, runHook } from "../lib/report.ts";

runHook(async () => {
  if (!terminalId()) return;
  const input = await readHookInput();
  if (!input.session_id || !input.agent_id) return;
  await postRelay("/relay/subagent/start", {
    parentSessionId: input.session_id,
    agentId: input.agent_id,
    agentType: input.agent_type ?? "agent",
  });
});
