#!/usr/bin/env bun
// SessionStart hook: register this terminal-tab Claude Code session with the in-app relay
// and, when the daemon is enabled (BISMUTH_MEMORY_DIR set), ask core's POST /memory/recall for
// the session-start context and print it as `additionalContext`.
import { hook, memoryDir, registerSession } from '../lib/report.ts'
import {
    SESSION_START_TIMEOUT_MS,
    printContext,
    requestRecall,
} from '../lib/recall.ts'

hook(async (input, tid) => {
    const [, context] = await Promise.all([
        registerSession(input, tid),
        memoryDir() && input.session_id
            ? requestRecall(
                  {
                      mode: 'session-start',
                      sessionId: input.session_id,
                      source: input.source,
                      transcriptPath: input.transcript_path,
                  },
                  SESSION_START_TIMEOUT_MS,
              )
            : Promise.resolve(null),
    ])
    printContext('SessionStart', context)
})
