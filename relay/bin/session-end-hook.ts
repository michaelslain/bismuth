#!/usr/bin/env bun
// SessionEnd hook, two best-effort jobs:
//   1. Drop this terminal-tab session from the agents graph NOW (on real exits), instead
//      of waiting for the whole pane to close. `clear`/`compact` keep Claude running in
//      this terminal (a fresh session re-registers via SessionStart), so we must NOT drop
//      the node for those.
//   2. When the daemon is enabled (BISMUTH_MEMORY_DIR set) AND the vault has
//      daemon.saveSessions on (checked here), collect the session transcript
//      into memory as an auto note — except on `compact` (the same logical session
//      continues). This replaces claude-bot's old global ~/.claude collect hook.
import { hook, postRelay, memoryDir } from '../lib/report.ts'
import { collectTranscript, saveSessionsEnabled } from '../lib/memory.ts'

hook(async input => {
    const reason = String(input.reason ?? '')
    const dir = memoryDir()

    // Collect the transcript (exit/logout/clear), drop the graph node (exit/logout only) —
    // concurrently, both best-effort.
    await Promise.all([
        dir && input.transcript_path && reason !== 'compact'
            ? saveSessionsEnabled(dir).then(on =>
                  on
                      ? collectTranscript(
                            dir,
                            input.transcript_path!,
                            input.session_id,
                        )
                      : undefined,
              )
            : Promise.resolve(),
        input.session_id && reason !== 'clear' && reason !== 'compact'
            ? postRelay('/relay/session/end', { sessionId: input.session_id })
            : Promise.resolve(),
    ])
})
