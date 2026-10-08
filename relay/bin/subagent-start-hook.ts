#!/usr/bin/env bun
// SubagentStart hook: a subagent was spawned by this session's Agent tool. Add it as
// a child node hanging off the spawning session (payload carries the parent session_id plus the
// subagent's stable agent_id + agent_type), and, when the daemon is enabled, ask core's
// POST /memory/recall for context for the new subagent and print it as `additionalContext`.
import { hook, memoryDir, postRelay, workflowId } from '../lib/report.ts'
import {
    SUBAGENT_TIMEOUT_MS,
    printContext,
    requestRecall,
} from '../lib/recall.ts'

hook(async input => {
    if (!input.session_id || !input.agent_id) return
    const sessionId = input.session_id
    const agentId = input.agent_id
    const [, context] = await Promise.all([
        postRelay('/relay/subagent/start', {
            parentSessionId: sessionId,
            agentId,
            agentType: input.agent_type ?? 'agent',
            // Non-empty only when this session runs under a workflow orchestration — groups the
            // subagent into its workflow's lane. Omitted (undefined) for ordinary subagents.
            workflowId: workflowId(),
        }),
        memoryDir()
            ? requestRecall(
                  {
                      mode: 'subagent',
                      sessionId,
                      agentId,
                      transcriptPath: input.transcript_path,
                  },
                  SUBAGENT_TIMEOUT_MS,
              )
            : Promise.resolve(null),
    ])
    printContext('SubagentStart', context)
})
