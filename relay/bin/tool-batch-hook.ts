#!/usr/bin/env bun
// PostToolBatch hook: after a batch of tool calls resolves, ask core's POST /memory/recall for
// memory relevant to what the tools just did and print it as `additionalContext`. Plugin hooks
// also fire inside subagents, where the payload carries `agent_id`. Memory only: no registry job.
import { hook, memoryDir } from '../lib/report.ts'
import {
    TOOL_BATCH_TIMEOUT_MS,
    capToolCalls,
    printContext,
    requestRecall,
} from '../lib/recall.ts'

hook(async input => {
    if (!memoryDir() || !input.session_id) return
    const toolCalls = capToolCalls(input.tool_calls)
    if (!toolCalls.length) return
    const context = await requestRecall(
        {
            mode: 'tool',
            sessionId: input.session_id,
            ...(input.agent_id ? { agentId: input.agent_id } : {}),
            transcriptPath: input.transcript_path,
            toolCalls,
        },
        TOOL_BATCH_TIMEOUT_MS,
    )
    printContext('PostToolBatch', context)
})
