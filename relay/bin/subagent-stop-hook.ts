#!/usr/bin/env bun
// SubagentStop hook: a subagent finished. Mark it done (it lingers briefly, then is
// pruned) and capture its final message. Payload carries the subagent's agent_id and
// last_assistant_message.
import { readHookInput, postRelay, terminalId, runHook } from "../lib/report.ts";

runHook(async () => {
  if (!terminalId()) return;
  const input = await readHookInput();
  if (!input.agent_id) return;
  await postRelay("/relay/subagent/stop", {
    agentId: input.agent_id,
    lastMessage: input.last_assistant_message,
  });
});
