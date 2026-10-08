#!/usr/bin/env bun
// UserPromptSubmit hook, two best-effort jobs run concurrently:
//   1. Keep this session "awake" in the agents graph (a full register, so a session whose
//      SessionStart was missed/dropped self-heals and still appears).
//   2. When the daemon is enabled for this vault (BISMUTH_MEMORY_DIR set), ask core's
//      POST /memory/recall for context relevant to the prompt and print it as
//      `additionalContext`. Core owns ranking; core unreachable → nothing is printed.
import { hook, memoryDir, registerSession } from '../lib/report.ts'
import { PROMPT_TIMEOUT_MS, printContext, requestRecall } from '../lib/recall.ts'

hook(async (input, tid) => {
    const [, context] = await Promise.all([
        registerSession(input, tid),
        memoryDir() && input.session_id && typeof input.prompt === 'string'
            ? requestRecall(
                  {
                      mode: 'prompt',
                      sessionId: input.session_id,
                      ...(input.agent_id ? { agentId: input.agent_id } : {}),
                      prompt: input.prompt,
                      transcriptPath: input.transcript_path,
                  },
                  PROMPT_TIMEOUT_MS,
              )
            : Promise.resolve(null),
    ])
    printContext('UserPromptSubmit', context)
})
