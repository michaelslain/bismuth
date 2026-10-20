// daemon.keepLogs's transcript half: a daemon session's Claude transcript is copied into the vault so
// it outlives Claude Code's own 30-day cleanup of ~/.claude/projects.
import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveSessionTranscript } from '../src/lib/sessionArchive.ts'
import { vaultPaths } from '../src/lib/config.ts'

const ID = '3f2a9c1e-0b7d-4e5f-9a1b-2c3d4e5f6a7b'

/** A vault plus a fake projects dir holding session ID's transcript and subagent dir. */
async function setup(keepLogs: boolean) {
    const base = await mkdtemp(join(tmpdir(), 'bismuth-archive-'))
    const ctx = vaultPaths(join(base, 'vault'))
    ctx.keepLogs = keepLogs
    const projects = join(base, 'projects')
    const project = join(projects, '-tmp-vault')
    await mkdir(join(project, ID, 'subagents'), { recursive: true })
    await writeFile(join(project, `${ID}.jsonl`), '{"type":"user"}\n')
    await writeFile(join(project, ID, 'subagents', 'agent-1.jsonl'), '{"type":"assistant"}\n')
    await writeFile(join(project, 'other.jsonl'), '{}\n')
    return { ctx, projects, project }
}

test('keepLogs on: the transcript and its subagent dir land in .daemon/logs/sessions', async () => {
    const { ctx, projects } = await setup(true)
    expect(await archiveSessionTranscript(ctx, ID, projects)).toBe(2)
    expect(ctx.sessionLogsDir).toBe(join(ctx.root, '.daemon', 'logs', 'sessions'))
    expect(await readFile(join(ctx.sessionLogsDir, `${ID}.jsonl`), 'utf-8')).toBe('{"type":"user"}\n')
    expect(
        await readFile(join(ctx.sessionLogsDir, ID, 'subagents', 'agent-1.jsonl'), 'utf-8'),
    ).toBe('{"type":"assistant"}\n')
    // only the named session is copied
    expect((await readdir(ctx.sessionLogsDir)).sort()).toEqual([ID, `${ID}.jsonl`].sort())
})

test('a later turn overwrites the copy with the grown transcript', async () => {
    const { ctx, projects, project } = await setup(true)
    await archiveSessionTranscript(ctx, ID, projects)
    await writeFile(join(project, `${ID}.jsonl`), '{"type":"user"}\n{"type":"assistant"}\n')
    await archiveSessionTranscript(ctx, ID, projects)
    expect(await readFile(join(ctx.sessionLogsDir, `${ID}.jsonl`), 'utf-8')).toBe(
        '{"type":"user"}\n{"type":"assistant"}\n',
    )
})

test('keepLogs off: nothing is written', async () => {
    const { ctx, projects } = await setup(false)
    expect(await archiveSessionTranscript(ctx, ID, projects)).toBe(0)
    expect(existsSync(ctx.sessionLogsDir)).toBe(false)
})

test('an id that could name a path is refused', async () => {
    const { ctx, projects } = await setup(true)
    expect(await archiveSessionTranscript(ctx, '../other', projects)).toBe(0)
    expect(await archiveSessionTranscript(ctx, '.', projects)).toBe(0)
    expect(existsSync(ctx.sessionLogsDir)).toBe(false)
})

test('a missing transcript or projects dir copies nothing and never throws', async () => {
    const { ctx, projects } = await setup(true)
    expect(await archiveSessionTranscript(ctx, 'not-a-session', projects)).toBe(0)
    expect(await archiveSessionTranscript(ctx, ID, join(projects, 'absent'))).toBe(0)
})
