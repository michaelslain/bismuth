// daemon/src/lib/sessionArchive.ts
// Copies a daemon session's Claude transcript into `<vault>/.daemon/logs/sessions/` when the vault
// sets `daemon.keepLogs`.
//
// WHY a copy and not a pointer: the Claude Agent SDK writes `~/.claude/projects/<cwd slug>/<id>.jsonl`
// (plus a sibling `<id>/` holding subagent transcripts), and Claude Code deletes those after its
// `cleanupPeriodDays` (30 by default) on any CLI start. The transcript is the one record of WHY a run
// did what it did, so a vault that wants its whole history keeps its own copy, beside the activity
// log, where nothing prunes it.
//
// Every project directory is searched for the id (the same shape as core's eraseClaudeSession), so
// the slug's encoding of the vault path never has to be reproduced here. The copy is overwritten on
// each turn: a resumed session's transcript only grows, and the latest copy holds every earlier one.
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { VaultContext } from './config.ts'

/** `~/.claude/projects`, or `$CLAUDE_CONFIG_DIR/projects` when the SDK was pointed elsewhere. */
export function claudeProjectsDir(
    env: NodeJS.ProcessEnv = process.env,
): string {
    return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
}

/** Copy session `id`'s transcript (and its subagent directory, if any) into ctx.sessionLogsDir.
 *  Returns how many entries were copied: 0 when keepLogs is off, the id is unusable, or the
 *  transcript is not on disk. Never throws: archiving must never fail the run it records. */
export async function archiveSessionTranscript(
    ctx: VaultContext,
    id: string,
    projectsDir: string = claudeProjectsDir(),
): Promise<number> {
    // An id is a uuid; anything with a path separator or a leading dot could name a path outside
    // the archive, so it is refused rather than sanitized.
    if (!ctx.keepLogs || !/^[A-Za-z0-9_-]+$/.test(id)) return 0
    let projects: string[]
    try {
        projects = await readdir(projectsDir)
    } catch {
        return 0
    }
    let copied = 0
    try {
        for (const project of projects) {
            for (const name of [`${id}.jsonl`, id]) {
                const src = join(projectsDir, project, name)
                const exists = await stat(src).then(
                    () => true,
                    () => false,
                )
                if (!exists) continue
                await mkdir(ctx.sessionLogsDir, { recursive: true })
                await cp(src, join(ctx.sessionLogsDir, name), {
                    recursive: true,
                    force: true,
                })
                copied++
            }
        }
    } catch (err) {
        console.error(
            `[session:${ctx.name}] Failed to archive transcript ${id}:`,
            err,
        )
    }
    return copied
}
