import { test as bunTest, expect, describe, beforeAll, afterAll } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { TOKENS, makeLeakVault, runCli, type RunOpts } from './visibilityLeak'
import { freePort } from '../../core/test/ports'

// The gate bypasses closed in one pass, each against the REAL CLI: a second root (`--dir`) that
// swapped the checked vault, a vault addressed by a subfolder, an agent rewriting the rules or a
// process definition, a folder token, and creators that append `.md` after the gate looked. Every
// daemon case runs through both the CLI-stamped and the MCP-stamped channel; each bypass has an
// owner case proving the owner's hand is still ungated.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const AGENTS: { name: string; opts: RunOpts }[] = [
    { name: 'daemon via cli', opts: { channel: 'daemon', via: 'cli' } },
    { name: 'daemon via mcp', opts: { channel: 'daemon', via: 'mcp' } },
    { name: 'chat via cli', opts: { channel: 'chat', via: 'cli' } },
]
const OWNER: RunOpts = { channel: 'owner' }

const text = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr

describe('--dir cannot swap the checked vault', () => {
    for (const { name, opts } of AGENTS)
        test(`${name}: read Private/secret.md --vault V --dir <empty> is refused`, async () => {
            const { vault } = makeLeakVault()
            const empty = mkdtempSync(join(tmpdir(), 'bismuth-leak-empty-'))
            const r = await runCli(
                ['read', 'Private/secret.md', '--vault', vault, '--dir', empty],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(text(r)).not.toContain(TOKENS.secret)
            expect(text(r)).toContain('Refused')
        })
    test('owner: the same argv still reads the note', async () => {
        const { vault } = makeLeakVault()
        const empty = mkdtempSync(join(tmpdir(), 'bismuth-leak-empty-'))
        const r = await runCli(
            ['read', 'Private/secret.md', '--vault', vault, '--dir', empty],
            OWNER,
        )
        expect(r.code).toBe(0)
        expect(text(r)).toContain(TOKENS.secret)
    })
})

describe('a vault addressed by a subfolder', () => {
    for (const { name, opts } of AGENTS.filter(a => a.opts.channel === 'daemon'))
        test(`${name}: read + tree through "V/Vault Hidden" are refused`, async () => {
            const { vault } = makeLeakVault()
            const sub = join(vault, 'Vault Hidden')
            const read = await runCli(['read', 'inner.md', '--vault', sub], opts)
            expect(read.code).not.toBe(0)
            expect(text(read)).not.toContain(TOKENS.folder)
            expect(text(read)).toContain('is inside the vault')
            const tree = await runCli(['tree', '--vault', sub], opts)
            expect(tree.code).not.toBe(0)
            expect(text(tree)).not.toContain('inner')
        })
    test('owner: the subfolder still reads', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(
            ['read', 'inner.md', '--vault', join(vault, 'Vault Hidden')],
            OWNER,
        )
        expect(r.code).toBe(0)
        expect(text(r)).toContain(TOKENS.folder)
    })
})

describe('an agent cannot rewrite the rules', () => {
    const attempts: [string, string[]][] = [
        ['folder-visibility --clear', ['folder-visibility', 'Vault Hidden', '--clear']],
        ['settings set folderVisibility {}', ['settings', 'set', 'folderVisibility', '{}']],
        ['write .settings', ['write', '.settings', '--content', 'folderVisibility: {}\n']],
    ]
    for (const { name, opts } of AGENTS.filter(a => a.opts.channel === 'daemon'))
        for (const [label, argv] of attempts)
            test(`${name}: ${label} is refused and .settings is untouched`, async () => {
                const { vault } = makeLeakVault()
                const before = readFileSync(join(vault, '.settings'))
                const r = await runCli(argv, opts)
                expect(r.code).not.toBe(0)
                expect(text(r)).toContain('Refused')
                expect(readFileSync(join(vault, '.settings')).equals(before)).toBe(true)
            })
    test('owner: folder-visibility --clear still edits the rules', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(['folder-visibility', 'Vault Hidden', '--clear'], OWNER)
        expect(r.code).toBe(0)
        expect(readFileSync(join(vault, '.settings'), 'utf8')).not.toContain('Vault Hidden')
    })
})

describe('folder tokens', () => {
    for (const { name, opts } of AGENTS.filter(a => a.opts.channel === 'daemon'))
        test(`${name}: move and delete of a hidden folder are refused`, async () => {
            const { vault } = makeLeakVault()
            mkdirSync(join(vault, 'Pub'))
            const mv = await runCli(['move', 'Vault Hidden', 'Pub'], opts)
            expect(mv.code).not.toBe(0)
            const del = await runCli(['delete', 'Vault Hidden'], opts)
            expect(del.code).not.toBe(0)
            expect(existsSync(join(vault, 'Vault Hidden', 'inner.md'))).toBe(true)
            expect(existsSync(join(vault, 'Pub', 'Vault Hidden'))).toBe(false)
        })
    test('owner: delete of the folder still works', async () => {
        const { vault } = makeLeakVault()
        const r = await runCli(['delete', 'Vault Hidden'], OWNER)
        expect(r.code).toBe(0)
        expect(existsSync(join(vault, 'Vault Hidden', 'inner.md'))).toBe(false)
    })
})

describe('process definitions are code', () => {
    function plainVault(): string {
        const v = mkdtempSync(join(tmpdir(), 'bismuth-leak-plain-'))
        writeFileSync(join(v, 'open.md'), `# Open\n${TOKENS.open}\n`)
        return v
    }
    for (const { name, opts } of AGENTS.filter(a => a.opts.channel === 'daemon'))
        test(`${name}: write .daemon/processes/x.md is refused in a vault with NO restrictions`, async () => {
            const v = plainVault()
            const r = await runCli(
                ['write', '.daemon/processes/x.md', '--content', 'command: ls\n', '--vault', v],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(text(r)).toContain('Refused')
            expect(existsSync(join(v, '.daemon', 'processes', 'x.md'))).toBe(false)
        })
    test('owner: the same write works', async () => {
        const v = plainVault()
        const r = await runCli(
            ['write', '.daemon/processes/x.md', '--content', 'command: ls\n', '--vault', v],
            OWNER,
        )
        expect(r.code).toBe(0)
        expect(existsSync(join(v, '.daemon', 'processes', 'x.md'))).toBe(true)
    })
})

describe('creators that append .md', () => {
    for (const { name, opts } of AGENTS.filter(a => a.opts.channel === 'daemon'))
        for (const group of ['base', 'calendar'])
            test(`${name}: ${group} create Private/secret is refused, note untouched`, async () => {
                const { vault } = makeLeakVault()
                const file = join(vault, 'Private', 'secret.md')
                const before = readFileSync(file)
                const argv =
                    group === 'base'
                        ? ['base', 'create', 'Private/secret', '--view', 'table']
                        : ['calendar', 'create', 'Private/secret']
                const r = await runCli(argv, opts)
                expect(r.code).not.toBe(0)
                expect(text(r)).toContain('Private/secret')
                expect(readFileSync(file).equals(before)).toBe(true)
            })
})

// ---- second pass: spellings of the same bypasses, the `.daemon` folder, the refuse tier, empty rules ----

const DAEMON = AGENTS.filter(a => a.opts.channel === 'daemon')

describe('folder tokens cannot be hidden behind another flag or respelled', () => {
    // Pub must NOT exist: a rename onto an existing dir fails for unrelated reasons and would
    // pass these tests on the old gate too.
    function pubVault(): string {
        return makeLeakVault().vault
    }
    const inner = (v: string) => join(v, 'Vault Hidden', 'inner.md')
    for (const { name, opts } of DAEMON) {
        test(`${name}: move "Vault Hidden" Pub --memory "Vault Hidden" is refused`, async () => {
            const v = pubVault()
            const r = await runCli(
                ['move', 'Vault Hidden', 'Pub', '--memory', 'Vault Hidden'],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(existsSync(inner(v))).toBe(true)
            expect(existsSync(join(v, 'Pub', 'Vault Hidden'))).toBe(false)
        })
        test(`${name}: move "../<vault>/Vault Hidden" Pub is refused`, async () => {
            const v = pubVault()
            const r = await runCli(
                ['move', `../${basename(v)}/Vault Hidden`, 'Pub'],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(existsSync(inner(v))).toBe(true)
            expect(existsSync(join(v, 'Pub', 'Vault Hidden'))).toBe(false)
        })
        test(`${name}: move "/<vault>/Vault Hidden" Pub (extra leading slash) is refused`, async () => {
            const v = pubVault()
            const r = await runCli(['move', `/${v}/Vault Hidden`, 'Pub'], opts)
            expect(r.code).not.toBe(0)
            expect(existsSync(inner(v))).toBe(true)
            expect(existsSync(join(v, 'Pub', 'Vault Hidden'))).toBe(false)
        })
        test(`${name}: the destination spelled "//<vault>/Vault Hidden/o.md" is refused`, async () => {
            const v = pubVault()
            const r = await runCli(
                ['move', 'open.md', `//${v}/Vault Hidden/o.md`],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(existsSync(join(v, 'open.md'))).toBe(true)
            expect(existsSync(join(v, 'Vault Hidden', 'o.md'))).toBe(false)
        })
    }
})

describe('the .daemon folder itself is protected', () => {
    for (const { name, opts } of DAEMON) {
        test(`${name}: move .daemon Stage is refused`, async () => {
            const { vault } = makeLeakVault()
            mkdirSync(join(vault, '.daemon', 'processes'), { recursive: true })
            writeFileSync(join(vault, '.daemon', 'processes', 'p.md'), 'command: ls\n')
            mkdirSync(join(vault, 'Stage'))
            const r = await runCli(['move', '.daemon', 'Stage'], opts)
            expect(r.code).not.toBe(0)
            expect(text(r)).toContain('Refused')
            expect(existsSync(join(vault, '.daemon', 'processes', 'p.md'))).toBe(true)
            expect(existsSync(join(vault, 'Stage', '.daemon'))).toBe(false)
        })
        test(`${name}: move Stage .daemon is refused`, async () => {
            const { vault } = makeLeakVault()
            mkdirSync(join(vault, 'Stage', 'processes'), { recursive: true })
            writeFileSync(join(vault, 'Stage', 'processes', 'evil.md'), 'command: ls\n')
            const r = await runCli(['move', 'Stage', '.daemon'], opts)
            expect(r.code).not.toBe(0)
            expect(existsSync(join(vault, '.daemon', 'processes', 'evil.md'))).toBe(false)
        })
    }
})

describe('the refuse tier and the api cannot write protected paths', () => {
    function plainVault(): string {
        const v = mkdtempSync(join(tmpdir(), 'bismuth-leak-plain-'))
        writeFileSync(join(v, 'open.md'), `# Open\n${TOKENS.open}\n`)
        return v
    }
    for (const { name, opts } of DAEMON) {
        test(`${name}: export --out .daemon/processes/z.md is refused in an unrestricted vault`, async () => {
            const v = plainVault()
            const r = await runCli(
                ['export', 'open.md', '--format', 'md', '--out', '.daemon/processes/z.md', '--vault', v],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(text(r)).toContain('Refused')
            expect(existsSync(join(v, '.daemon', 'processes', 'z.md'))).toBe(false)
        })
    }
})

describe('an empty hidden folder still counts as a restriction', () => {
    for (const { name, opts } of DAEMON)
        test(`${name}: folder-visibility Journal --clear is refused when .settings hides empty Journal`, async () => {
            const v = mkdtempSync(join(tmpdir(), 'bismuth-leak-empty-folder-'))
            writeFileSync(join(v, 'open.md'), `# Open\n${TOKENS.open}\n`)
            mkdirSync(join(v, 'Journal'))
            const rules = 'folderVisibility:\n  Journal: hidden\n'
            writeFileSync(join(v, '.settings'), rules)
            const r = await runCli(['folder-visibility', 'Journal', '--clear', '--vault', v], opts)
            expect(r.code).not.toBe(0)
            expect(text(r)).toContain('Refused')
            expect(readFileSync(join(v, '.settings'), 'utf8')).toBe(rules)
        })
})

/** A real core on `port` serving `vault`, registered in a private BISMUTH_RUN_DIR (set on this
 *  process so runCli inherits it). Always stop() in afterAll. */
async function startCore(port: number, vault: string) {
    const saved = process.env.BISMUTH_RUN_DIR
    const runDir = mkdtempSync(join(tmpdir(), 'bismuth-leak-run-'))
    process.env.BISMUTH_RUN_DIR = runDir
    const memory = mkdtempSync(join(tmpdir(), 'bismuth-leak-mem-'))
    const env: Record<string, string | undefined> = { ...process.env, BROWSER: 'none' }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    const proc = Bun.spawn(
        ['bun', 'run', join(import.meta.dir, '..', '..', 'core/src/server.ts'),
         '--port', String(port), '--vault', vault, '--memory', memory],
        { env, stdout: 'ignore', stderr: 'ignore' },
    )
    for (let i = 0; i < 150; i++) {
        try {
            if ((await fetch(`http://localhost:${port}/version`)).ok) break
        } catch {}
        await Bun.sleep(100)
    }
    return {
        stop() {
            proc.kill()
            if (saved === undefined) delete process.env.BISMUTH_RUN_DIR
            else process.env.BISMUTH_RUN_DIR = saved
        },
    }
}

async function runCliNoVault(args: string[], opts: RunOpts) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    if ((opts.via ?? 'cli') === 'mcp') env.BISMUTH_MCP_CHANNEL = opts.channel
    else env.BISMUTH_AGENT_CHANNEL = opts.channel
    const proc = Bun.spawn(
        ['bun', 'run', join(import.meta.dir, '..', 'src', 'index.ts'), ...args],
        { env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

describe('HTTP-routed commands are gated against every running core vault', () => {
    const PORT = freePort()
    let core: { stop(): void } | undefined
    beforeAll(async () => {
        core = await startCore(PORT, makeLeakVault().vault)
    }, 30_000)
    afterAll(() => core?.stop())
    const route = '/file?path=Private/secret.md'
    for (const { name, opts } of DAEMON) {
        test(`${name}: api GET with no --vault and no BISMUTH_VAULT is refused`, async () => {
            const r = await runCliNoVault(['api', 'GET', route, '--api', `http://localhost:${PORT}`], opts)
            expect(text(r)).not.toContain(TOKENS.secret)
            expect(r.code).not.toBe(0)
        })
        test(`${name}: api GET with --vault <empty dir> --api <the core> is refused`, async () => {
            const empty = mkdtempSync(join(tmpdir(), 'bismuth-leak-empty-'))
            const r = await runCli(
                ['api', 'GET', route, '--vault', empty, '--api', `http://localhost:${PORT}`],
                opts,
            )
            expect(text(r)).not.toContain(TOKENS.secret)
            expect(r.code).not.toBe(0)
        })
    }
})

describe('agents may only GET through bismuth api', () => {
    const PORT = freePort()
    let core: { stop(): void } | undefined
    let vault = ''
    beforeAll(async () => {
        vault = mkdtempSync(join(tmpdir(), 'bismuth-leak-plain-'))
        writeFileSync(join(vault, 'open.md'), `# Open\n${TOKENS.open}\n`)
        core = await startCore(PORT, vault)
    }, 30_000)
    afterAll(() => core?.stop())
    const put = (path: string) => [
        'api', 'PUT', '/file', '--json',
        JSON.stringify({ path, contents: 'command: ls\n' }),
        '--vault', '', '--api', `http://localhost:${PORT}`,
    ]
    for (const { name, opts } of DAEMON)
        for (const target of ['.daemon/processes/evil.md', '.settings', 'plain.md'])
            test(`${name}: api PUT /file ${target} is refused and writes nothing`, async () => {
                const argv = put(target)
                argv[argv.indexOf('--vault') + 1] = vault
                const r = await runCli(argv, opts)
                expect(r.code).not.toBe(0)
                expect(text(r)).toContain('only GET')
                const f = join(vault, target)
                expect(!existsSync(f) || !readFileSync(f, 'utf8').includes('command: ls')).toBe(true)
            })
    test('owner: the same PUT writes the file', async () => {
        const argv = put('owner-wrote.md')
        argv[argv.indexOf('--vault') + 1] = vault
        const r = await runCli(argv, OWNER)
        expect(r.code).toBe(0)
        expect(existsSync(join(vault, 'owner-wrote.md'))).toBe(true)
    })
})

// R1: a registry record whose pid is alive but whose vault is gone must not lock out HTTP-routed
// commands; R2: percent-encoded spellings of protected paths / hidden notes must be refused for
// `api GET`, since the server decodes them.
describe('stale run records + percent-encoded api paths', () => {
    const PORT = freePort()
    const PORT_RESTRICTED = freePort()
    let core: { stop(): void } | undefined
    let restrictedCore: { stop(): void } | undefined
    let vault = ''
    let restricted = ''
    let staleRunDir = ''
    beforeAll(async () => {
        vault = mkdtempSync(join(tmpdir(), 'bismuth-leak-plain-'))
        writeFileSync(join(vault, 'open.md'), `# Open\n${TOKENS.open}\n`)
        writeFileSync(join(vault, '.settings'), '# RULES-FILE-MARKER\n')
        mkdirSync(join(vault, '.daemon', 'processes'), { recursive: true })
        writeFileSync(join(vault, '.daemon', 'processes', 'p.md'), 'command: PROCDEF-MARKER\n')
        core = await startCore(PORT, vault)
        // startCore left BISMUTH_RUN_DIR pointing at its private registry (the stale-record test
        // below writes into it and removes the record again, so the other tests see a clean one).
        staleRunDir = process.env.BISMUTH_RUN_DIR as string
        const saved = process.env.BISMUTH_RUN_DIR
        restricted = makeLeakVault().vault
        restrictedCore = await startCore(PORT_RESTRICTED, restricted)
        // keep the first registry (it holds the stale record); the second core wrote its own dir
        process.env.BISMUTH_RUN_DIR = saved
    }, 60_000)
    afterAll(() => {
        core?.stop()
        restrictedCore?.stop()
    })
    const api = (route: string, v: string, port: number) => [
        'api', 'GET', route, '--vault', v, '--api', `http://localhost:${port}`,
    ]
    for (const { name, opts } of DAEMON) {
        test(`${name}: a record whose vault is gone does not refuse api GET`, async () => {
            const gone = '/nonexistent/vault'
            const rec = join(staleRunDir, `${Buffer.from(gone).toString('base64url')}.json`)
            writeFileSync(rec, JSON.stringify({ port: freePort(), vault: gone, pid: process.pid }))
            try {
                const r = await runCli(api('/version', vault, PORT), opts)
                expect(text(r)).not.toContain('could not resolve')
                expect(r.code).toBe(0)
            } finally {
                rmSync(rec, { force: true })
            }
        })
        for (const [route, marker] of [
            ['/file?path=%2Esettings', 'RULES-FILE-MARKER'],
            ['/file?path=.daemon%2Fprocesses%2Fp.md', 'PROCDEF-MARKER'],
        ])
            test(`${name}: api GET ${route} is refused`, async () => {
                const r = await runCli(api(route, vault, PORT), opts)
                expect(text(r)).not.toContain(marker)
                expect(r.code).not.toBe(0)
                expect(text(r)).toContain('Refused')
            })
        test(`${name}: api GET with a percent-encoded hidden note path is refused`, async () => {
            const r = await runCli(
                api('/file?path=Private%2Fsecret.md', restricted, PORT_RESTRICTED),
                opts,
            )
            expect(text(r)).not.toContain(TOKENS.secret)
            expect(r.code).not.toBe(0)
        })
    }
    test('owner: the encoded rules-file path still reads', async () => {
        const r = await runCli(api('/file?path=%2Esettings', vault, PORT), OWNER)
        expect(r.code).toBe(0)
        expect(text(r)).toContain('RULES-FILE-MARKER')
    })
})
