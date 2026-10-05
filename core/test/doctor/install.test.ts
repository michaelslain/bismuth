import { describe, test, expect, afterEach } from 'bun:test'
import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultIO } from '../../src/bismuthInstall'
import {
    installRepairs,
    installSection,
    parseClaudeMcpCommand,
} from '../../src/doctor/sections/install'
import type { DoctorContext } from '../../src/doctor/types'
import { fakeCtx } from './fakeCtx'

const realRelink = installRepairs.relink
afterEach(() => {
    installRepairs.relink = realRelink
})

const ids = async (ctx: DoctorContext) =>
    (await installSection.check(ctx)).map(f => f.id)
const find = async (ctx: DoctorContext, id: string) =>
    (await installSection.check(ctx)).find(f => f.id === id)

function installed(ctx: DoctorContext, marker = 'a:b') {
    mkdirSync(join(ctx.bismuthHome, 'bin'), { recursive: true })
    writeFileSync(join(ctx.bismuthHome, '.version'), marker)
}

function mcpGet(command: string) {
    return {
        which: (bin: string) => (bin === 'claude' ? '/x/claude' : null),
        exec: async () => ({
            code: 0,
            stdout: `bismuth:\n  Scope: User config\n  Type: stdio\n  Command: ${command}\n  Args:\n`,
            stderr: '',
        }),
    }
}

describe('install section', () => {
    test('nothing installed yields exactly install.not-installed (info)', async () => {
        const ctx = fakeCtx()
        const f = await installSection.check(ctx)
        expect(f.map(x => x.id)).toEqual(['install.not-installed'])
        expect(f[0].severity).toBe('info')
        expect(f[0].repair).toBeUndefined()
    })

    test('a different hash than installSrc yields install.version-skew (safe)', async () => {
        const ctx = fakeCtx()
        const src = join(ctx.home, 'src')
        mkdirSync(join(src, 'bin'), { recursive: true })
        writeFileSync(join(src, 'bin', 'bismuth'), 'cli')
        writeFileSync(join(src, 'bin', 'bismuth-mcp'), 'mcp')
        installed(ctx, 'old:old')
        const f = await find(
            { ...ctx, installSrc: src },
            'install.version-skew',
        )
        expect(f?.severity).toBe('warn')
        expect(f?.repair?.risk).toBe('safe')
        expect(f?.repair?.description).toContain(src)
    })

    test('a matching hash or no installSrc is not skew', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        expect(await ids(ctx)).not.toContain('install.version-skew')
        const src = join(ctx.home, 'src')
        mkdirSync(join(src, 'bin'), { recursive: true })
        writeFileSync(join(src, 'bin', 'bismuth'), 'cli')
        writeFileSync(join(src, 'bin', 'bismuth-mcp'), 'mcp')
        const hash = await defaultIO.hashSrc(src)
        writeFileSync(join(ctx.bismuthHome, '.version'), hash!)
        expect(await ids({ ...ctx, installSrc: src })).not.toContain(
            'install.version-skew',
        )
    })

    test('installed with no link in any linkDir yields install.cli-link-missing', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        const f = await find(ctx, 'install.cli-link-missing')
        expect(f?.repair?.risk).toBe('safe')
    })

    test('a current, live link is fine', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        const dest = join(ctx.bismuthHome, 'bin', 'bismuth')
        writeFileSync(dest, 'x')
        mkdirSync(ctx.linkDirs[0], { recursive: true })
        symlinkSync(dest, join(ctx.linkDirs[0], 'bismuth'))
        expect(await ids(ctx)).toEqual([])
    })

    test('a foreign link or file is ignored', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        mkdirSync(ctx.linkDirs[0], { recursive: true })
        symlinkSync(
            '/Users/x/proj/.bismuth-notes/bin/bismuth',
            join(ctx.linkDirs[0], 'bismuth'),
        )
        expect(await ids(ctx)).toEqual(['install.cli-link-missing'])
    })

    test('an old-home link yields install.cli-link-stale:<path>; the unlink half applies', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        mkdirSync(ctx.linkDirs[0], { recursive: true })
        const link = join(ctx.linkDirs[0], 'bismuth')
        symlinkSync('/Users/old/.bismuth/bin/bismuth', link)
        let relinks = 0
        installRepairs.relink = () => {
            relinks++
            return { ok: true, path: null }
        }
        const f = await find(ctx, `install.cli-link-stale:${link}`)
        expect(f?.severity).toBe('warn')
        expect(f?.repair?.risk).toBe('safe')
        expect(await f!.repair!.apply()).toEqual([])
        expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined()
        expect(await f!.repair!.apply()).toEqual([])
        expect(relinks).toBe(2)
    })

    test('a relative link resolving to an old-home path elsewhere is stale', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        mkdirSync(ctx.linkDirs[0], { recursive: true })
        // <home>/usr-local-bin/../../old/.bismuth/bin/bismuth = <tmp>/old/..., outside ctx.home. Only
        // resolution against the link's directory yields an absolute old-home path to judge.
        symlinkSync(
            '../../old/.bismuth/bin/bismuth',
            join(ctx.linkDirs[0], 'bismuth'),
        )
        expect(await ids(ctx)).toEqual([
            `install.cli-link-stale:${join(ctx.linkDirs[0], 'bismuth')}`,
        ])
    })

    test('a relative link resolving to the current home install is healthy, not stale', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        writeFileSync(join(ctx.bismuthHome, 'bin', 'bismuth'), '')
        mkdirSync(ctx.linkDirs[1], { recursive: true })
        // <home>/.local/bin/../../.bismuth/bin/bismuth = <home>/.bismuth/bin/bismuth. Judged by its
        // raw relative text it would look like an old home.
        symlinkSync(
            '../../.bismuth/bin/bismuth',
            join(ctx.linkDirs[1], 'bismuth'),
        )
        expect(
            (await ids(ctx)).filter(id => id.startsWith('install.cli-link')),
        ).toEqual([])
    })

    test('a relink warning is returned, never thrown', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        installRepairs.relink = () => {
            throw new Error('boom')
        }
        const f = await find(ctx, 'install.cli-link-missing')
        expect(await f!.repair!.apply()).toEqual(['relink failed: boom'])
    })

    test('claude mcp naming an old-home binary yields install.mcp-claude-stale', async () => {
        const ctx = fakeCtx(mcpGet('/Users/old/.bismuth/bin/bismuth-mcp'))
        installed(ctx)
        const f = await find(ctx, 'install.mcp-claude-stale')
        expect(f?.repair?.risk).toBe('safe')
    })

    test('claude mcp naming a missing current-home binary is stale; an existing one is fine', async () => {
        const bin = (c: DoctorContext) =>
            join(c.bismuthHome, 'bin', 'bismuth-mcp')
        const ctx = fakeCtx()
        installed(ctx)
        const withMcp = { ...ctx, ...mcpGet(bin(ctx)) }
        expect(await ids(withMcp)).toContain('install.mcp-claude-stale')
        writeFileSync(bin(ctx), 'x')
        expect(await ids(withMcp)).not.toContain('install.mcp-claude-stale')
    })

    test('a non-zero exit yields install.mcp-claude-missing', async () => {
        const ctx = fakeCtx({
            which: () => '/x/claude',
            exec: async () => ({
                code: 1,
                stdout: '',
                stderr: 'No MCP server',
            }),
        })
        installed(ctx)
        const f = await find(ctx, 'install.mcp-claude-missing')
        expect(f?.repair?.risk).toBe('safe')
    })

    test('unparseable output, a spawn failure, a foreign command or no claude report nothing', async () => {
        const base = fakeCtx()
        installed(base)
        const run = (stdout: string, code = 0, which = '/x/claude') =>
            ids({
                ...base,
                which: () => which || null,
                exec: async () => ({ code, stdout, stderr: '' }),
            })
        const claudeIds = (l: string[]) =>
            l.filter(i => i.includes('mcp-claude'))
        expect(claudeIds(await run('garbage with no command line'))).toEqual([])
        expect(claudeIds(await run('', -1))).toEqual([])
        expect(claudeIds(await run('  Command: /opt/mine/server'))).toEqual([])
        expect(claudeIds(await run('', 1, ''))).toEqual([])
    })

    test('parseClaudeMcpCommand reads the Command line', () => {
        expect(parseClaudeMcpCommand('x\n  Command: /a/b c\n  Args:')).toBe(
            '/a/b c',
        )
        expect(parseClaudeMcpCommand('nothing')).toBeNull()
    })

    test('a ledger id with no bin/bismuth-mcp yields install.mcp-other-stale:<id>', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        writeFileSync(
            join(ctx.bismuthHome, '.mcp-registrations.json'),
            JSON.stringify({ codex: { at: 'now', method: 'cli' } }),
        )
        const f = await find(ctx, 'install.mcp-other-stale:codex')
        expect(f?.severity).toBe('warn')
        expect(f?.repair?.risk).toBe('safe')
        expect(f?.repair?.description).toContain('Codex')
        writeFileSync(join(ctx.bismuthHome, 'bin', 'bismuth-mcp'), 'x')
        expect(await ids(ctx)).not.toContain('install.mcp-other-stale:codex')
    })

    test('a ledger id no registrar knows is reported without a repair', async () => {
        const ctx = fakeCtx()
        installed(ctx)
        writeFileSync(
            join(ctx.bismuthHome, '.mcp-registrations.json'),
            JSON.stringify({ nonesuch: {} }),
        )
        const f = await find(ctx, 'install.mcp-other-stale:nonesuch')
        expect(f).toBeDefined()
        expect(f?.repair).toBeUndefined()
    })
})
