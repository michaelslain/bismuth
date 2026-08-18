// core/test/agentBackends/mcpRegistrars.test.ts
// Unit-tests core/src/agentBackends/mcpRegistrars.ts: the pure JSON/YAML merge helpers directly
// (plain strings, no fs at all), plus every registrar end-to-end through a REAL-fs-backed
// RegistrarIO whose `homedir()` points at a fresh mkdtemp dir per test — so `readFile`/`writeFile`
// are the actual disk implementations (exercising mkdirSync/JSON.stringify/etc. for real) while
// never touching the user's actual ~/.codex, ~/.cline, ~/.openclaw, ~/.gemini, ~/.qwen,
// ~/.copilot, ~/.config/amp, ~/.factory, ~/.config/crush, or ~/.config/goose. `which`/`run` are
// always fully faked — no test spawns a real agent CLI.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    createCodexRegistrar,
    createClineRegistrar,
    createOpenClawRegistrar,
    createGeminiRegistrar,
    createQwenRegistrar,
    createCopilotRegistrar,
    createAmpRegistrar,
    createDroidRegistrar,
    createCrushRegistrar,
    createGooseRegistrar,
    MCP_REGISTRARS,
    defaultRegistrarIO,
    patchJsonMcpServerEnv,
    removeJsonMcpServer,
    upsertJsonMcpServer,
    upsertYamlExtension,
    removeYamlExtension,
    type RegistrarIO,
    type BismuthMcpSpec,
    type McpRegistrar,
} from '../../src/agentBackends/mcpRegistrars'

// ------------------------------------------------------------------------------------------------
// Group 1: pure JSON helpers — plain strings in, plain strings out, no fs/subprocess involved.
// ------------------------------------------------------------------------------------------------

test("patchJsonMcpServerEnv sets only the target entry's env, preserving unrelated keys + other servers", () => {
    const before = JSON.stringify(
        {
            someUnrelatedTopLevelKey: { nested: true },
            mcpServers: {
                other: { command: 'npx', args: ['-y', 'other-mcp'] },
                bismuth: {
                    command: '/old/bismuth-mcp',
                    args: [],
                    disabled: false,
                },
            },
        },
        null,
        2,
    )
    const { text } = patchJsonMcpServerEnv(before, ['mcpServers'], 'bismuth', {
        BISMUTH_CLI: '/x',
    })
    expect(text).not.toBeNull()
    const parsed = JSON.parse(text!)
    expect(parsed.someUnrelatedTopLevelKey).toEqual({ nested: true })
    expect(parsed.mcpServers.other).toEqual({
        command: 'npx',
        args: ['-y', 'other-mcp'],
    })
    expect(parsed.mcpServers.bismuth).toEqual({
        command: '/old/bismuth-mcp',
        args: [],
        disabled: false,
        env: { BISMUTH_CLI: '/x' },
    })
})

test("patchJsonMcpServerEnv is a no-op signal (null text) when the target entry doesn't exist yet or JSON is unparseable", () => {
    expect(
        patchJsonMcpServerEnv(
            JSON.stringify({ mcpServers: {} }),
            ['mcpServers'],
            'bismuth',
            {},
        ).text,
    ).toBeNull()
    expect(
        patchJsonMcpServerEnv('{not valid json', ['mcpServers'], 'bismuth', {})
            .text,
    ).toBeNull()
})

test('removeJsonMcpServer removes only OUR entry, leaving a foreign one + unrelated keys untouched', () => {
    const isOurs = (e: unknown) =>
        (e as any)?.command === '/home/.bismuth/bin/bismuth-mcp'
    const before = JSON.stringify({
        unrelated: 1,
        mcpServers: {
            other: { command: 'npx' },
            bismuth: { command: '/home/.bismuth/bin/bismuth-mcp' },
        },
    })
    const ours = removeJsonMcpServer(before, ['mcpServers'], 'bismuth', isOurs)
    expect(ours.removed).toBe(true)
    const parsedOurs = JSON.parse(ours.text!)
    expect(parsedOurs.mcpServers.bismuth).toBeUndefined()
    expect(parsedOurs.mcpServers.other).toEqual({ command: 'npx' })
    expect(parsedOurs.unrelated).toBe(1)

    const foreignBefore = JSON.stringify({
        mcpServers: { bismuth: { command: '/some/other/tool' } },
    })
    const foreign = removeJsonMcpServer(
        foreignBefore,
        ['mcpServers'],
        'bismuth',
        isOurs,
    )
    expect(foreign.removed).toBe(false)
    expect(foreign.text).toBe(foreignBefore)
})

test('upsertJsonMcpServer creates a fresh entry (and container) when absent, preserving unrelated keys', () => {
    const before = JSON.stringify({
        unrelated: { a: 1 },
        mcp: { other: { command: 'npx' } },
    })
    const isOurs = (e: unknown) =>
        (e as any)?.command?.startsWith?.('/home/.bismuth')
    const result = upsertJsonMcpServer(
        before,
        ['mcp'],
        'bismuth',
        {
            type: 'stdio',
            command: '/home/.bismuth/bin/bismuth-mcp',
            args: [],
            env: {},
        },
        isOurs,
    )
    const parsed = JSON.parse(result.text!)
    expect(parsed.unrelated).toEqual({ a: 1 })
    expect(parsed.mcp.other).toEqual({ command: 'npx' })
    expect(parsed.mcp.bismuth.command).toBe('/home/.bismuth/bin/bismuth-mcp')
})

test('upsertJsonMcpServer refuses to clobber a foreign entry', () => {
    const isOurs = (e: unknown) =>
        (e as any)?.command?.startsWith?.('/home/.bismuth')
    const before = JSON.stringify({
        mcp: { bismuth: { command: '/somewhere/else' } },
    })
    const result = upsertJsonMcpServer(
        before,
        ['mcp'],
        'bismuth',
        { command: '/home/.bismuth/bin/bismuth-mcp' },
        isOurs,
    )
    expect(result.text).toBeNull()
    expect(result.warning).toMatch(/wasn't created by Bismuth/)
})

// ------------------------------------------------------------------------------------------------
// Group 2: pure YAML helpers (Goose's `extensions:` LIST — array-of-objects, not name-keyed).
// ------------------------------------------------------------------------------------------------

const gooseIsOurs = (e: unknown) =>
    (e as any)?.transport?.command?.startsWith?.('/home/.bismuth')

test('upsertYamlExtension appends a new entry, preserving unrelated top-level keys, comments, and other extensions', () => {
    const before =
        'provider: anthropic\nmodel: claude\n# a comment worth keeping\nextensions:\n  - name: other\n    enabled: true\n    transport:\n      type: stdio\n      command: npx\n      args: [foo]\n'
    const result = upsertYamlExtension(
        before,
        'bismuth',
        {
            name: 'bismuth',
            enabled: true,
            transport: {
                type: 'stdio',
                command: '/home/.bismuth/bin/bismuth-mcp',
                args: [],
            },
            env: {},
        },
        gooseIsOurs,
    )
    expect(result.text).not.toBeNull()
    expect(result.text).toContain('# a comment worth keeping')
    expect(result.text).toContain('provider: anthropic')
    expect(result.text).toContain('command: npx') // the other extension survives verbatim
    expect(result.text).toContain('command: /home/.bismuth/bin/bismuth-mcp')
})

test('upsertYamlExtension creates the extensions: list fresh when absent (including a null/missing file)', () => {
    const result = upsertYamlExtension(
        null,
        'bismuth',
        { name: 'bismuth', enabled: true },
        gooseIsOurs,
    )
    expect(result.text).toContain('extensions:')
    expect(result.text).toContain('name: bismuth')
})

test('upsertYamlExtension refuses to clobber a foreign extension entry', () => {
    const before =
        'extensions:\n  - name: bismuth\n    transport:\n      command: /somewhere/else\n'
    const result = upsertYamlExtension(
        before,
        'bismuth',
        { name: 'bismuth' },
        gooseIsOurs,
    )
    expect(result.text).toBeNull()
    expect(result.warning).toMatch(/wasn't created by Bismuth/)
})

test('removeYamlExtension removes only OUR entry, leaving a foreign one + siblings untouched', () => {
    const before =
        'extensions:\n  - name: other\n    transport:\n      command: npx\n  - name: bismuth\n    transport:\n      command: /home/.bismuth/bin/bismuth-mcp\n'
    const ours = removeYamlExtension(before, 'bismuth', gooseIsOurs)
    expect(ours.removed).toBe(true)
    expect(ours.text).toContain('name: other')
    expect(ours.text).not.toContain('bismuth')

    const foreignBefore =
        'extensions:\n  - name: bismuth\n    transport:\n      command: /somewhere/else\n'
    const foreign = removeYamlExtension(foreignBefore, 'bismuth', gooseIsOurs)
    expect(foreign.removed).toBe(false)
    expect(foreign.text).toBe(foreignBefore)
})

// ------------------------------------------------------------------------------------------------
// Group 3: registrars end-to-end, through a real-fs RegistrarIO rooted at a mkdtemp "home".
// ------------------------------------------------------------------------------------------------

let home: string
let runCalls: Array<{ bin: string; args: string[] }>

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bismuth-mcpreg-home-'))
    runCalls = []
})
afterEach(() => {
    rmSync(home, { recursive: true, force: true })
})

function specFor(h: string): BismuthMcpSpec {
    return {
        mcpBin: join(h, '.bismuth', 'bin', 'bismuth-mcp'),
        docsDir: join(h, '.bismuth', 'docs'),
        cliBin: join(h, '.bismuth', 'bin', 'bismuth'),
    }
}

/** A real-fs IO (readFile/writeFile delegate to defaultRegistrarIO, so mkdirSync/JSON writes are
 *  exercised for real) rooted at `home`, with `which`/`run` fully faked and recorded. */
function makeIO(
    opts: {
        which?: (bin: string) => string | null
        run?: RegistrarIO['run']
    } = {},
): RegistrarIO {
    return {
        which: opts.which ?? (bin => `/usr/local/bin/${bin}`),
        run:
            opts.run ??
            (async (bin, args) => {
                runCalls.push({ bin, args })
                return { code: 0, stdout: '', stderr: '' }
            }),
        readFile: defaultRegistrarIO.readFile,
        writeFile: defaultRegistrarIO.writeFile,
        homedir: () => home,
        now: () => '2026-01-01T00:00:00.000Z',
    }
}

// --- Missing binary → warning, never a throw (every registrar this build knows) ----------------

test('every registrar yields a warning (not a throw) when its binary is missing', async () => {
    for (const factory of [
        createCodexRegistrar,
        createClineRegistrar,
        createOpenClawRegistrar,
        createGeminiRegistrar,
        createQwenRegistrar,
        createCopilotRegistrar,
        createAmpRegistrar,
        createDroidRegistrar,
        createCrushRegistrar,
        createGooseRegistrar,
    ]) {
        const io = makeIO({ which: () => null })
        const registrar = factory(io)
        const result = await registrar.register(specFor(home))
        expect(result.ok).toBe(false)
        expect(result.warning).toBeTruthy()
        expect(registrar.detect()).toBeNull()
    }
})

test('MCP_REGISTRARS (the real, default-IO singleton list) includes every CLI this build knows', () => {
    const ids = MCP_REGISTRARS.map(r => r.id).sort()
    expect(ids).toEqual(
        [
            'amp',
            'cline',
            'codex',
            'copilot',
            'crush',
            'droid',
            'gemini',
            'goose',
            'openclaw',
            'qwen',
        ].sort(),
    )
})

// --- OpenClaw: verifies the specific "mcp.servers, NOT top-level mcpServers" nesting gotcha -----

test('OpenClaw writes under mcp.servers.bismuth, never top-level mcpServers', async () => {
    const io = makeIO()
    const registrar = createOpenClawRegistrar(io)
    const result = await registrar.register(specFor(home))
    expect(result.ok).toBe(true)
    // register() itself doesn't rewrite the file (the CLI's `mcp set` does that in real life) — but
    // isRegistered()'s file-reading path must agree on the nesting, so simulate what `openclaw mcp
    // set` would have persisted and assert isRegistered() reads it from the right place.
    const configPath = join(home, '.openclaw', 'openclaw.json')
    defaultRegistrarIO.writeFile(
        configPath,
        JSON.stringify({
            mcp: { servers: { bismuth: { command: specFor(home).mcpBin } } },
        }),
    )
    expect(await registrar.isRegistered()).toBe(true)
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(raw.mcp.servers.bismuth).toBeDefined()
    expect(raw.mcpServers).toBeUndefined()
})

// --- Foreign "bismuth" entry is never clobbered, across every JSON-precheck registrar -----------

const jsonForeignCases: Array<{
    make: (io: RegistrarIO) => McpRegistrar
    configRelPath: string[]
    keyPath: string[]
}> = [
    {
        make: createClineRegistrar,
        configRelPath: [
            '.cline',
            'data',
            'settings',
            'cline_mcp_settings.json',
        ],
        keyPath: ['mcpServers'],
    },
    {
        make: createOpenClawRegistrar,
        configRelPath: ['.openclaw', 'openclaw.json'],
        keyPath: ['mcp', 'servers'],
    },
    {
        make: createGeminiRegistrar,
        configRelPath: ['.gemini', 'settings.json'],
        keyPath: ['mcpServers'],
    },
    {
        make: createQwenRegistrar,
        configRelPath: ['.qwen', 'settings.json'],
        keyPath: ['mcpServers'],
    },
    {
        make: createCopilotRegistrar,
        configRelPath: ['.copilot', 'mcp-config.json'],
        keyPath: ['mcpServers'],
    },
    {
        make: createAmpRegistrar,
        configRelPath: ['.config', 'amp', 'settings.json'],
        keyPath: ['amp.mcpServers'],
    },
    {
        make: createDroidRegistrar,
        configRelPath: ['.factory', 'mcp.json'],
        keyPath: ['mcpServers'],
    },
]

for (const { make, configRelPath, keyPath } of jsonForeignCases) {
    test(`${make(makeIO()).label}: a foreign "bismuth" entry is never clobbered, and the CLI is never invoked`, async () => {
        const configPath = join(home, ...configRelPath)
        let obj: any = { unrelatedTopLevelKey: true }
        let cur = obj
        for (const k of keyPath) {
            cur[k] = {}
            cur = cur[k]
        }
        cur.bismuth = { command: '/some/foreign/tool' }
        const before = JSON.stringify(obj, null, 2)
        defaultRegistrarIO.writeFile(configPath, before)

        const io = makeIO()
        const registrar = make(io)
        const result = await registrar.register(specFor(home))
        expect(result.ok).toBe(false)
        expect(result.warning).toMatch(/didn't create/)
        expect(runCalls).toEqual([]) // never even tried to spawn the CLI
        expect(readFileSync(configPath, 'utf8')).toBe(before) // byte-for-byte untouched
    })
}

// --- Crush + Goose: file-only fallback (no `mcp add` subcommand exists for either) --------------

test('Crush: registers by writing mcp.bismuth directly (no CLI add subcommand exists), idempotently', async () => {
    const io = makeIO()
    const registrar = createCrushRegistrar(io)
    const spec = specFor(home)
    const r1 = await registrar.register(spec)
    expect(r1.ok).toBe(true)
    expect(runCalls).toEqual([]) // crush is never spawned — file-only
    const configPath = join(home, '.config', 'crush', 'crush.json')
    const afterFirst = readFileSync(configPath, 'utf8')
    expect(JSON.parse(afterFirst).mcp.bismuth).toEqual({
        type: 'stdio',
        command: spec.mcpBin,
        args: [],
        env: expect.any(Object),
    })

    const r2 = await registrar.register(spec)
    expect(r2.ok).toBe(true)
    expect(readFileSync(configPath, 'utf8')).toBe(afterFirst) // byte-identical second time = idempotent

    expect(await registrar.isRegistered()).toBe(true)
    await registrar.unregister()
    expect(await registrar.isRegistered()).toBe(false)
})

test('Crush: a foreign mcp.bismuth entry survives register() untouched', async () => {
    const configPath = join(home, '.config', 'crush', 'crush.json')
    const before = JSON.stringify({
        mcp: { bismuth: { command: '/foreign' }, other: { command: 'npx' } },
    })
    defaultRegistrarIO.writeFile(configPath, before)
    const registrar = createCrushRegistrar(makeIO())
    const result = await registrar.register(specFor(home))
    expect(result.ok).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toBe(before)
})

test('Goose: registers by writing extensions[] directly (no non-interactive add exists), idempotently, preserving other keys', async () => {
    const configPath = join(home, '.config', 'goose', 'config.yaml')
    defaultRegistrarIO.writeFile(
        configPath,
        'provider: anthropic\nmodel: claude\nextensions:\n  - name: other\n    enabled: true\n',
    )
    const io = makeIO()
    const registrar = createGooseRegistrar(io)
    const spec = specFor(home)
    const r1 = await registrar.register(spec)
    expect(r1.ok).toBe(true)
    expect(runCalls).toEqual([]) // goose is never spawned — file-only
    const afterFirst = readFileSync(configPath, 'utf8')
    expect(afterFirst).toContain('provider: anthropic')
    expect(afterFirst).toContain('name: other')
    expect(afterFirst).toContain(spec.mcpBin)

    const r2 = await registrar.register(spec)
    expect(r2.ok).toBe(true)
    expect(readFileSync(configPath, 'utf8')).toBe(afterFirst) // idempotent

    expect(await registrar.isRegistered()).toBe(true)
    await registrar.unregister()
    expect(await registrar.isRegistered()).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toContain('name: other') // sibling extension survives
})

test('Goose: a foreign bismuth extension entry survives register() untouched', async () => {
    const configPath = join(home, '.config', 'goose', 'config.yaml')
    const before =
        'extensions:\n  - name: bismuth\n    transport:\n      command: /foreign\n'
    defaultRegistrarIO.writeFile(configPath, before)
    const registrar = createGooseRegistrar(makeIO())
    const result = await registrar.register(specFor(home))
    expect(result.ok).toBe(false)
    expect(readFileSync(configPath, 'utf8')).toBe(before)
})

// --- Unregister is gated on OUR OWN ledger, never a blind CLI-remove call -----------------------

test('unregister() is a no-op (never spawns the CLI) when we never registered in the first place', async () => {
    for (const factory of [
        createCodexRegistrar,
        createOpenClawRegistrar,
        createGeminiRegistrar,
    ]) {
        runCalls = []
        const registrar = factory(makeIO())
        await registrar.unregister()
        expect(runCalls).toEqual([])
    }
})

test('Codex: register()/unregister() round-trip is ledger-gated (TOML itself is never read or written)', async () => {
    const registrar = createCodexRegistrar(makeIO())
    const spec = specFor(home)
    const reg = await registrar.register(spec)
    expect(reg.ok).toBe(true)
    const addCall = runCalls.find(
        c => c.args[0] === 'mcp' && c.args[1] === 'add',
    )
    expect(addCall).toBeDefined()
    expect(addCall!.args).toContain('--')
    expect(addCall!.args[addCall!.args.length - 1]).toBe(spec.mcpBin)
    // No file of ANY kind was written for Codex — its config is TOML, which this module never touches.
    expect(existsSync(join(home, '.codex'))).toBe(false)

    runCalls = []
    await registrar.unregister()
    const removeCall = runCalls.find(
        c => c.args[0] === 'mcp' && c.args[1] === 'remove',
    )
    expect(removeCall).toBeDefined() // now it DOES call remove, because our own ledger says we own it

    runCalls = []
    await registrar.unregister() // ledger already cleared — second call is a no-op
    expect(runCalls).toEqual([])
})

// --- Cline / Qwen: two-step "CLI creates the entry, we patch in only env" ------------------------

test('Cline: register() patches only the env block onto the entry the CLI (simulated) just created', async () => {
    const configPath = join(
        home,
        '.cline',
        'data',
        'settings',
        'cline_mcp_settings.json',
    )
    const io = makeIO({
        run: async (bin, args) => {
            runCalls.push({ bin, args })
            // Simulate `cline mcp add` persisting a bare entry with no env (verified: no --env flag).
            defaultRegistrarIO.writeFile(
                configPath,
                JSON.stringify({
                    mcpServers: {
                        bismuth: { command: specFor(home).mcpBin, args: [] },
                    },
                }),
            )
            return { code: 0, stdout: '', stderr: '' }
        },
    })
    const registrar = createClineRegistrar(io)
    const spec = specFor(home)
    const result = await registrar.register(spec)
    expect(result.ok).toBe(true)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.mcpServers.bismuth.env).toEqual({
        BISMUTH_CLI: spec.cliBin,
        BISMUTH_DOCS_DIR: spec.docsDir,
    })
    const addCall = runCalls[0]
    expect(addCall.args).toEqual([
        'mcp',
        'add',
        'bismuth',
        '--transport',
        'stdio',
        '--yes',
        '--',
        spec.mcpBin,
    ])
    expect(addCall.args).not.toContain('--env') // verified: no --env flag on cline mcp add
})

// --- Gemini / Qwen family: verifies the supportsEnvFlag split (Gemini has -e, Qwen doesn't) -----

test("Gemini's add call carries -e env flags directly; Qwen's does not (two-step patch instead)", async () => {
    const spec = specFor(home)

    const geminiIo = makeIO()
    await createGeminiRegistrar(geminiIo).register(spec)
    const geminiArgs = runCalls[0].args
    expect(geminiArgs).toContain('-e')
    expect(geminiArgs).toEqual([
        'mcp',
        'add',
        'bismuth',
        spec.mcpBin,
        '-e',
        `BISMUTH_CLI=${spec.cliBin}`,
        '-e',
        `BISMUTH_DOCS_DIR=${spec.docsDir}`,
        '--scope',
        'user',
    ])

    runCalls = []
    const qwenConfigPath = join(home, '.qwen', 'settings.json')
    const qwenIo = makeIO({
        run: async (bin, args) => {
            runCalls.push({ bin, args })
            defaultRegistrarIO.writeFile(
                qwenConfigPath,
                JSON.stringify({
                    mcpServers: { bismuth: { command: spec.mcpBin } },
                }),
            )
            return { code: 0, stdout: '', stderr: '' }
        },
    })
    await createQwenRegistrar(qwenIo).register(spec)
    const qwenArgs = runCalls[0].args
    expect(qwenArgs).not.toContain('-e')
    expect(qwenArgs).toEqual([
        'mcp',
        'add',
        'bismuth',
        spec.mcpBin,
        '--scope',
        'user',
    ])
    const qwenWritten = JSON.parse(readFileSync(qwenConfigPath, 'utf8'))
    expect(qwenWritten.mcpServers.bismuth.env).toEqual({
        BISMUTH_CLI: spec.cliBin,
        BISMUTH_DOCS_DIR: spec.docsDir,
    })
})

// --- Batch-3 CLI-add registrars: pin the exact verified argv shape per CLI ----------------------

test("Copilot's add call: --env repeated, then -- <mcpBin>", async () => {
    const spec = specFor(home)
    await createCopilotRegistrar(makeIO()).register(spec)
    expect(runCalls[0].args).toEqual([
        'mcp',
        'add',
        'bismuth',
        '--env',
        `BISMUTH_CLI=${spec.cliBin}`,
        '--env',
        `BISMUTH_DOCS_DIR=${spec.docsDir}`,
        '--',
        spec.mcpBin,
    ])
})

test("Amp's add call: --env repeated, then -- <mcpBin>, against the LITERAL dotted key amp.mcpServers", async () => {
    const spec = specFor(home)
    const io = makeIO()
    const registrar = createAmpRegistrar(io)
    await registrar.register(spec)
    expect(runCalls[0].args).toEqual([
        'mcp',
        'add',
        'bismuth',
        '--env',
        `BISMUTH_CLI=${spec.cliBin}`,
        '--env',
        `BISMUTH_DOCS_DIR=${spec.docsDir}`,
        '--',
        spec.mcpBin,
    ])

    // isRegistered() must read the literal one-segment key "amp.mcpServers", not nested amp.mcpServers.
    const configPath = join(home, '.config', 'amp', 'settings.json')
    defaultRegistrarIO.writeFile(
        configPath,
        JSON.stringify({
            'amp.mcpServers': { bismuth: { command: spec.mcpBin } },
        }),
    )
    expect(await registrar.isRegistered()).toBe(true)
    const raw = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(raw['amp.mcpServers'].bismuth).toBeDefined()
    expect(raw.amp).toBeUndefined() // NOT a nested { amp: { mcpServers: {...} } } object
})

test("Droid's add call: the command is a single positional string, not a `-- cmd` split", async () => {
    const spec = specFor(home)
    await createDroidRegistrar(makeIO()).register(spec)
    expect(runCalls[0].args).toEqual([
        'mcp',
        'add',
        'bismuth',
        spec.mcpBin,
        '--env',
        `BISMUTH_CLI=${spec.cliBin}`,
        '--env',
        `BISMUTH_DOCS_DIR=${spec.docsDir}`,
    ])
    expect(runCalls[0].args).not.toContain('--')
})
