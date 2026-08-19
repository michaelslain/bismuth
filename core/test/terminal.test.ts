import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import {
    writeFileSync,
    existsSync,
    chmodSync,
    symlinkSync,
    mkdirSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import {
    createTerminalSession,
    killSession,
    sessionCount,
    resizeSession,
    buildPtyEnv,
    loginShellArgs,
    shimSpecsFor,
    serializeShimSpecs,
    SHIM_FIELD_SEP,
    SHIM_RECORD_SEP,
    type BackendShimCandidate,
    type ShimSpec,
} from '../src/terminal'
import {
    registerSession,
    snapshot as relaySnapshot,
    resetRelay,
} from '../src/relay'

function tmp() {
    return tempDir('bismuth-term-')
}

const ENV_BASE = {
    base: { PATH: '/usr/bin' },
    relayUrl: 'http://localhost:4321',
    terminalId: 'tab-1',
    shimAvailable: true,
    pluginDir: '/repo/relay',
    shimDir: '/repo/relay/shim',
    zdotDir: '/repo/relay/shim/zdotdir',
}

test('buildPtyEnv points ZDOTDIR at the zsh init dir whenever the shim is available', () => {
    expect(
        buildPtyEnv({ ...ENV_BASE, realClaude: '/usr/local/bin/claude' })
            .ZDOTDIR,
    ).toBe('/repo/relay/shim/zdotdir')
    // Decoupled from realClaude: the zdotdir init resolves `claude` from PATH when it's null.
    expect(buildPtyEnv({ ...ENV_BASE, realClaude: null }).ZDOTDIR).toBe(
        '/repo/relay/shim/zdotdir',
    )
    expect(
        buildPtyEnv({ ...ENV_BASE, shimAvailable: false, realClaude: null })
            .ZDOTDIR,
    ).toBeUndefined()
})

test('buildPtyEnv sets relay provenance vars + TERM', () => {
    const env = buildPtyEnv({ ...ENV_BASE, realClaude: null })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.CLAUDE_RELAY_URL).toBe('http://localhost:4321')
    expect(env.CLAUDE_TERMINAL_ID).toBe('tab-1')
})

test("buildPtyEnv sets BISMUTH_API to this core's URL so in-tab `bismuth app` targets the right window", () => {
    const env = buildPtyEnv({
        ...ENV_BASE,
        relayUrl: 'http://localhost:4399',
        realClaude: null,
    })
    expect(env.BISMUTH_API).toBe('http://localhost:4399')
})

test('buildPtyEnv injects BISMUTH_MEMORY_DIR only when a memoryDir is given (the daemon gate)', () => {
    // Off (daemon disabled / not passed) → no injection, so memory hooks + MCP tools no-op.
    expect(
        buildPtyEnv({ ...ENV_BASE, realClaude: null }).BISMUTH_MEMORY_DIR,
    ).toBeUndefined()
    // On → the active vault's memory dir is injected, scoping recall/collect to this session.
    expect(
        buildPtyEnv({
            ...ENV_BASE,
            realClaude: null,
            memoryDir: '/vault/.daemon/memory',
        }).BISMUTH_MEMORY_DIR,
    ).toBe('/vault/.daemon/memory')
})

test("buildPtyEnv keeps Bismuth's 3rd-brain memory ISOLATED from Claude's own memory store", () => {
    // Bismuth scopes memory ONLY through its own BISMUTH_MEMORY_DIR var. It must never redirect
    // Claude Code's native memory/config store (CLAUDE_CONFIG_DIR → ~/.claude), or the two stores
    // would collide — a session opened in Bismuth would read/write the wrong brain.
    const base = {
        HOME: '/Users/x',
        CLAUDE_CONFIG_DIR: '/Users/x/.claude',
        PATH: '/usr/bin',
    }
    const env = buildPtyEnv({
        ...ENV_BASE,
        base,
        realClaude: null,
        memoryDir: '/vault/.daemon/memory',
    })
    // Injects its OWN var...
    expect(env.BISMUTH_MEMORY_DIR).toBe('/vault/.daemon/memory')
    // ...and leaves Claude's native config/memory dir exactly as inherited — never repointed at the vault.
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude')
    expect(env.CLAUDE_CONFIG_DIR).not.toBe(env.BISMUTH_MEMORY_DIR)
    // Bismuth sets no other CLAUDE_* memory var beyond relay provenance (URL + terminal id) and the
    // two host-workflow-provenance vars it EMPTIES (#107: CLAUDE_JOB_DIR/CLAUDE_WORKFLOW_ID → "" so a
    // tab's Claude isn't tagged with the app's own workflow key). It still never repoints the memory store.
    const claudeVars = Object.keys(env)
        .filter(k => k.startsWith('CLAUDE_'))
        .sort()
    expect(claudeVars).toEqual([
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_JOB_DIR',
        'CLAUDE_RELAY_URL',
        'CLAUDE_TERMINAL_ID',
        'CLAUDE_WORKFLOW_ID',
    ])
})

test('buildPtyEnv prepends the shim to PATH + sets BISMUTH_REAL_CLAUDE when claude resolves', () => {
    const env = buildPtyEnv({
        ...ENV_BASE,
        realClaude: '/usr/local/bin/claude',
    })
    expect(env.BISMUTH_REAL_CLAUDE).toBe('/usr/local/bin/claude')
    expect(env.BISMUTH_RELAY_PLUGIN).toBe('/repo/relay')
    expect(env.PATH).toBe('/repo/relay/shim:/usr/bin')
})

test('buildPtyEnv activates the zsh shim without a resolved claude (no REAL_CLAUDE, PATH unchanged)', () => {
    const env = buildPtyEnv({ ...ENV_BASE, realClaude: null })
    expect(env.BISMUTH_RELAY_PLUGIN).toBe('/repo/relay')
    expect(env.ZDOTDIR).toBe('/repo/relay/shim/zdotdir')
    expect(env.BISMUTH_REAL_CLAUDE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin') // PATH shim only added when a binary is resolved
})

test('buildPtyEnv skips the shim entirely when relay is not available', () => {
    const env = buildPtyEnv({
        ...ENV_BASE,
        shimAvailable: false,
        realClaude: '/usr/local/bin/claude',
    })
    expect(env.BISMUTH_RELAY_PLUGIN).toBeUndefined()
    expect(env.ZDOTDIR).toBeUndefined()
    expect(env.BISMUTH_REAL_CLAUDE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin') // unchanged
})

test('buildPtyEnv never produces a trailing-colon PATH when base has no PATH', () => {
    const env = buildPtyEnv({
        ...ENV_BASE,
        base: {},
        realClaude: '/usr/local/bin/claude',
    })
    expect(env.PATH).toBe('/repo/relay/shim') // no trailing ":" (which POSIX reads as cwd)
})

test('buildPtyEnv strips undefined base values', () => {
    const env = buildPtyEnv({
        ...ENV_BASE,
        base: { PATH: '/usr/bin', NOPE: undefined },
        realClaude: null,
    })
    expect('NOPE' in env).toBe(false)
})

test("buildPtyEnv neutralizes the host's Claude-Code workflow provenance (Bug #107)", () => {
    // If Bismuth is launched from inside a Claude session, CLAUDE_JOB_DIR / CLAUDE_WORKFLOW_ID are in
    // the parent env. They MUST NOT reach a terminal tab, or the relay's SubagentStart hook
    // (workflowId()) mis-tags every ordinary subagent with the app's phantom workflow, garbling the
    // agents graph. They're overridden with "" (not deleted): bun-pty merges the C-level environ under
    // this object, so only an explicit empty value actually clears the parent's — the relay reads ""
    // as "no workflow".
    const env = buildPtyEnv({
        ...ENV_BASE,
        base: {
            PATH: '/usr/bin',
            CLAUDE_JOB_DIR: '/Users/x/.claude/jobs/abcd1234',
            CLAUDE_WORKFLOW_ID: 'wf-9',
        },
        realClaude: null,
    })
    expect(env.CLAUDE_JOB_DIR).toBe('')
    expect(env.CLAUDE_WORKFLOW_ID).toBe('')
    expect(env.PATH).toBe('/usr/bin') // unrelated base vars are untouched
})

// --- shimSpecsFor (pure) --------------------------------------------------------------------

const CLAUDE_CANDIDATE: BackendShimCandidate = {
    id: 'claude',
    binary: 'claude',
    relayReporting: 'hooks',
    terminal: true,
}
const OPENCODE_NONE_CANDIDATE: BackendShimCandidate = {
    id: 'opencode',
    binary: 'opencode',
    relayReporting: 'none',
    terminal: true,
}
const WRAPPER_CANDIDATE: BackendShimCandidate = {
    id: 'opencode',
    binary: 'opencode',
    relayReporting: 'wrapper',
    terminal: true,
}

test("shimSpecsFor produces claude's spec matching today's behavior (mode hooks, resolved path passed through)", () => {
    const specs = shimSpecsFor(
        [CLAUDE_CANDIDATE],
        () => '/usr/local/bin/claude',
        { wrapperReportingEnabled: false },
    )
    expect(specs).toEqual([
        {
            id: 'claude',
            binary: 'claude',
            realPath: '/usr/local/bin/claude',
            mode: 'hooks',
        },
    ])
})

test("shimSpecsFor keeps an unresolved backend's spec entry (realPath: null) rather than dropping it", () => {
    // Dropping it entirely would lose the zsh init's only signal to retry via `whence -p` — see the
    // resolved-claude-is-null test below in buildPtyEnv for the existing behavior this generalizes.
    const specs = shimSpecsFor([CLAUDE_CANDIDATE], () => null, {
        wrapperReportingEnabled: false,
    })
    expect(specs).toEqual([
        { id: 'claude', binary: 'claude', realPath: null, mode: 'hooks' },
    ])
})

test("shimSpecsFor omits a 'none' backend entirely, regardless of resolvability", () => {
    const specs = shimSpecsFor(
        [OPENCODE_NONE_CANDIDATE],
        () => '/usr/local/bin/opencode',
        { wrapperReportingEnabled: true },
    )
    expect(specs).toEqual([])
})

test("shimSpecsFor: wrapper-vs-hooks distinction — a 'wrapper' backend is included only when wrapperReportingEnabled", () => {
    const resolve = () => '/usr/local/bin/opencode'
    expect(
        shimSpecsFor([WRAPPER_CANDIDATE], resolve, {
            wrapperReportingEnabled: false,
        }),
    ).toEqual([])
    expect(
        shimSpecsFor([WRAPPER_CANDIDATE], resolve, {
            wrapperReportingEnabled: true,
        }),
    ).toEqual([
        {
            id: 'opencode',
            binary: 'opencode',
            realPath: '/usr/local/bin/opencode',
            mode: 'wrapper',
        },
    ])
})

test("shimSpecsFor never emits a 'wrapper' entry for claude, even if the catalog claimed one", () => {
    const misconfigured: BackendShimCandidate = {
        id: 'claude',
        binary: 'claude',
        relayReporting: 'wrapper',
        terminal: true,
    }
    const specs = shimSpecsFor([misconfigured], () => '/usr/local/bin/claude', {
        wrapperReportingEnabled: true,
    })
    expect(specs).toEqual([])
})

test('shimSpecsFor omits a backend with no terminal surface', () => {
    const noTerminal: BackendShimCandidate = {
        id: 'x',
        binary: 'x',
        relayReporting: 'hooks',
        terminal: false,
    }
    expect(
        shimSpecsFor([noTerminal], () => '/usr/bin/x', {
            wrapperReportingEnabled: false,
        }),
    ).toEqual([])
})

test('shimSpecsFor handles a mixed list: resolved hooks + resolved wrapper + unresolved wrapper + none, in order', () => {
    const resolvableWrapper: BackendShimCandidate = {
        id: 'goose',
        binary: 'goose',
        relayReporting: 'wrapper',
        terminal: true,
    }
    const unresolvableWrapper: BackendShimCandidate = {
        id: 'gemini',
        binary: 'gemini',
        relayReporting: 'wrapper',
        terminal: true,
    }
    const resolve = (bin: string) =>
        bin === 'gemini' ? null : `/usr/local/bin/${bin}`
    const specs = shimSpecsFor(
        [
            CLAUDE_CANDIDATE,
            resolvableWrapper,
            unresolvableWrapper,
            OPENCODE_NONE_CANDIDATE,
        ],
        resolve,
        { wrapperReportingEnabled: true },
    )
    expect(specs).toEqual([
        {
            id: 'claude',
            binary: 'claude',
            realPath: '/usr/local/bin/claude',
            mode: 'hooks',
        },
        {
            id: 'goose',
            binary: 'goose',
            realPath: '/usr/local/bin/goose',
            mode: 'wrapper',
        },
        { id: 'gemini', binary: 'gemini', realPath: null, mode: 'wrapper' },
    ])
})

test('serializeShimSpecs round-trips through the ASCII US/RS delimiters', () => {
    const specs: ShimSpec[] = [
        {
            id: 'claude',
            binary: 'claude',
            realPath: '/usr/local/bin/claude',
            mode: 'hooks',
        },
        { id: 'opencode', binary: 'opencode', realPath: null, mode: 'wrapper' },
    ]
    const wire = serializeShimSpecs(specs)
    expect(wire).toBe(
        ['claude', 'claude', '/usr/local/bin/claude', 'hooks'].join(
            SHIM_FIELD_SEP,
        ) +
            SHIM_RECORD_SEP +
            ['opencode', 'opencode', '', 'wrapper'].join(SHIM_FIELD_SEP),
    )
    // Decode it back the way the zsh init / agent-shim would (plain split, no jq/python).
    const records = wire
        .split(SHIM_RECORD_SEP)
        .map(r => r.split(SHIM_FIELD_SEP))
    expect(records).toEqual([
        ['claude', 'claude', '/usr/local/bin/claude', 'hooks'],
        ['opencode', 'opencode', '', 'wrapper'],
    ])
})

test('serializeShimSpecs of an empty list is the empty string', () => {
    expect(serializeShimSpecs([])).toBe('')
})

// --- buildPtyEnv: shimSpecs / wrapperShimDir -------------------------------------------------

test('buildPtyEnv sets BISMUTH_SHIM_SPECS from shimSpecs when present, omits it when absent/empty', () => {
    const specs: ShimSpec[] = [
        {
            id: 'claude',
            binary: 'claude',
            realPath: '/usr/local/bin/claude',
            mode: 'hooks',
        },
    ]
    const withSpecs = buildPtyEnv({
        ...ENV_BASE,
        realClaude: null,
        shimSpecs: specs,
    })
    expect(withSpecs.BISMUTH_SHIM_SPECS).toBe(serializeShimSpecs(specs))

    // Omitted entirely (old-shaped caller) → no BISMUTH_SHIM_SPECS at all, byte-identical to before
    // this field existed.
    const withoutSpecs = buildPtyEnv({ ...ENV_BASE, realClaude: null })
    expect(withoutSpecs.BISMUTH_SHIM_SPECS).toBeUndefined()

    // Explicitly empty → also omitted (nothing to describe).
    const emptySpecs = buildPtyEnv({
        ...ENV_BASE,
        realClaude: null,
        shimSpecs: [],
    })
    expect(emptySpecs.BISMUTH_SHIM_SPECS).toBeUndefined()
})

test('buildPtyEnv never sets BISMUTH_SHIM_SPECS when the shim is unavailable, even with specs given', () => {
    const specs: ShimSpec[] = [
        {
            id: 'claude',
            binary: 'claude',
            realPath: '/usr/local/bin/claude',
            mode: 'hooks',
        },
    ]
    const env = buildPtyEnv({
        ...ENV_BASE,
        shimAvailable: false,
        realClaude: null,
        shimSpecs: specs,
    })
    expect(env.BISMUTH_SHIM_SPECS).toBeUndefined()
})

test('buildPtyEnv prepends wrapperShimDir to PATH only when shimSpecs contains a resolved wrapper entry', () => {
    const wrapperSpec: ShimSpec = {
        id: 'opencode',
        binary: 'opencode',
        realPath: '/usr/local/bin/opencode',
        mode: 'wrapper',
    }
    const withWrapper = buildPtyEnv({
        ...ENV_BASE,
        realClaude: null,
        shimSpecs: [wrapperSpec],
        wrapperShimDir: '/tmp/bismuth-agent-shim-xyz',
    })
    expect(withWrapper.PATH).toBe('/tmp/bismuth-agent-shim-xyz:/usr/bin')

    // wrapperShimDir given but no wrapper-mode entries in shimSpecs → not added.
    const hooksOnly = buildPtyEnv({
        ...ENV_BASE,
        realClaude: null,
        shimSpecs: [
            {
                id: 'claude',
                binary: 'claude',
                realPath: '/usr/local/bin/claude',
                mode: 'hooks',
            },
        ],
        wrapperShimDir: '/tmp/bismuth-agent-shim-xyz',
    })
    expect(hooksOnly.PATH).toBe('/usr/bin')

    // wrapperShimDir given but the only wrapper entry is unresolved (realPath: null) → not added.
    const unresolvedWrapper = buildPtyEnv({
        ...ENV_BASE,
        realClaude: null,
        shimSpecs: [
            {
                id: 'opencode',
                binary: 'opencode',
                realPath: null,
                mode: 'wrapper',
            },
        ],
        wrapperShimDir: '/tmp/bismuth-agent-shim-xyz',
    })
    expect(unresolvedWrapper.PATH).toBe('/usr/bin')

    // Both claude's shimDir and wrapperShimDir active at once — claude's is prepended first, then
    // wrapperShimDir goes in front of that (order doesn't matter for correctness, just documenting it).
    const both = buildPtyEnv({
        ...ENV_BASE,
        realClaude: '/usr/local/bin/claude',
        shimSpecs: [wrapperSpec],
        wrapperShimDir: '/tmp/bismuth-agent-shim-xyz',
    })
    expect(both.PATH).toBe(
        '/tmp/bismuth-agent-shim-xyz:/repo/relay/shim:/usr/bin',
    )
})

// --- Real zsh integration: the generated per-backend functions ------------------------------
// Exercises the ACTUAL shipped relay/shim/zdotdir/.zshrc against stub executables on PATH, driven
// by a real zsh subprocess — never a real agent CLI (only claude/opencode/openclaw exist on this
// machine; this proves the mechanism generically with throwaway stubs instead).

const HAS_ZSH2 = existsSync('/bin/zsh')
const SHIM_ZDOTDIR2 = join(
    import.meta.dir,
    '..',
    '..',
    'relay',
    'shim',
    'zdotdir',
)
// wrap.ts is invoked as `bun run …` by the generated function/shim — the test's own PATH is
// deliberately minimal (mimicking a stripped launchd/GUI env), so `bun` itself needs adding, same
// as a real login shell would resolve it via ~/.zprofile (Homebrew/nvm) in production.
const BUN_DIR = dirname(process.execPath)

function makeStubBin(dir: string, name: string): string {
    const p = join(dir, name)
    writeFileSync(p, `#!/bin/sh\necho "ARGV:$@"\n`)
    chmodSync(p, 0o755)
    return p
}

test.if(HAS_ZSH2 && existsSync(SHIM_ZDOTDIR2))(
    'zsh init defines one function per BISMUTH_SHIM_SPECS entry with the right injected argv',
    async () => {
        const home = tmp()
        const binDir = tmp()
        const relayDir = tmp() // fake BISMUTH_RELAY_PLUGIN — only needs a bin/wrap.ts for the wrapper case
        const claudeStub = makeStubBin(binDir, 'fake-claude-bin')
        const gooseStub = makeStubBin(binDir, 'fake-goose-bin') // stands in for a "wrapper"-mode real binary

        // A wrap.ts stub that just echoes its own argv — proves the zsh function passes backendId +
        // realPath + the user's own args through, without actually invoking any real relay networking.
        const wrapDir = join(relayDir, 'bin')
        mkdirSync(wrapDir, { recursive: true })
        writeFileSync(
            join(wrapDir, 'wrap.ts'),
            `console.log("WRAP_ARGV:" + Bun.argv.slice(2).join("|"));\n`,
        )

        const specs: ShimSpec[] = [
            {
                id: 'claude',
                binary: 'claude',
                realPath: claudeStub,
                mode: 'hooks',
            },
            {
                id: 'goose',
                binary: 'goose',
                realPath: gooseStub,
                mode: 'wrapper',
            },
            // Unresolved (both core and — since nothing named "nope" is on PATH — whence -p) → no function.
            { id: 'nope', binary: 'nope', realPath: null, mode: 'wrapper' },
        ]

        const runIn = (cmd: string) =>
            Bun.spawn(['/bin/zsh', ...loginShellArgs(), '-i', '-c', cmd], {
                env: {
                    HOME: home,
                    ZDOTDIR: SHIM_ZDOTDIR2,
                    PATH: `${BUN_DIR}:/usr/bin:/bin`,
                    TERM: 'dumb',
                    BISMUTH_RELAY_PLUGIN: relayDir,
                    BISMUTH_SHIM_SPECS: serializeShimSpecs(specs),
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })

        const claudeProc = runIn('claude foo bar')
        const claudeOut = await new Response(claudeProc.stdout).text()
        await claudeProc.exited
        expect(claudeOut).toContain(`ARGV:--plugin-dir ${relayDir} foo bar`)

        const gooseProc = runIn('goose --flag val')
        const gooseOut = await new Response(gooseProc.stdout).text()
        await gooseProc.exited
        expect(gooseOut).toContain(`WRAP_ARGV:goose|${gooseStub}|--flag|val`)

        // "nope" never resolves anywhere (not pre-resolved, not on PATH via whence -p) → no function
        // defined at all, so the shell falls through to "command not found" rather than a broken call.
        const nopeProc = runIn('nope; echo exit=$?')
        const nopeOut = await new Response(nopeProc.stdout).text()
        await nopeProc.exited
        expect(nopeOut).not.toContain('exit=0')
    },
)

test.if(HAS_ZSH2 && existsSync(SHIM_ZDOTDIR2))(
    'zsh init resolves a backend via whence -p when core could not pre-resolve it (the fallback claude already relied on, generalized)',
    async () => {
        const home = tmp()
        const binDir = tmp()
        const relayDir = tmp()
        makeStubBin(binDir, 'goose') // named exactly "goose" so `whence -p goose` finds it

        const specs: ShimSpec[] = [
            { id: 'goose', binary: 'goose', realPath: null, mode: 'hooks' },
        ]

        const proc = Bun.spawn(
            ['/bin/zsh', ...loginShellArgs(), '-i', '-c', 'goose hi'],
            {
                env: {
                    HOME: home,
                    ZDOTDIR: SHIM_ZDOTDIR2,
                    // binDir (holding the "goose" stub) is on PATH so whence -p can find it AFTER rc loads —
                    // core's own pre-resolution (realPath: null above) deliberately couldn't.
                    PATH: `${binDir}:/usr/bin:/bin`,
                    TERM: 'dumb',
                    BISMUTH_RELAY_PLUGIN: relayDir,
                    BISMUTH_SHIM_SPECS: serializeShimSpecs(specs),
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const out = await new Response(proc.stdout).text()
        await proc.exited
        expect(out).toContain(`ARGV:--plugin-dir ${relayDir} hi`)
    },
)

// --- Real non-zsh PATH shim (relay/shim/agent-shim) -----------------------------------------

const AGENT_SHIM_SCRIPT_PATH = join(
    import.meta.dir,
    '..',
    '..',
    'relay',
    'shim',
    'agent-shim',
)

test.if(existsSync(AGENT_SHIM_SCRIPT_PATH))(
    'relay/shim/agent-shim dispatches on its own invoked name via BISMUTH_SHIM_SPECS',
    async () => {
        const shimDir = tmp()
        const binDir = tmp()
        const relayDir = tmp()
        const gooseStub = makeStubBin(binDir, 'fake-goose-bin')
        symlinkSync(AGENT_SHIM_SCRIPT_PATH, join(shimDir, 'goose'))

        const wrapDir = join(relayDir, 'bin')
        mkdirSync(wrapDir, { recursive: true })
        writeFileSync(
            join(wrapDir, 'wrap.ts'),
            `console.log("WRAP_ARGV:" + Bun.argv.slice(2).join("|"));\n`,
        )

        const specs: ShimSpec[] = [
            {
                id: 'goose',
                binary: 'goose',
                realPath: gooseStub,
                mode: 'wrapper',
            },
        ]

        const proc = Bun.spawn([join(shimDir, 'goose'), '--x'], {
            env: {
                BISMUTH_RELAY_PLUGIN: relayDir,
                BISMUTH_SHIM_SPECS: serializeShimSpecs(specs),
                PATH: `${BUN_DIR}:/usr/bin:/bin`,
            },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const out = await new Response(proc.stdout).text()
        await proc.exited
        expect(out).toContain(`WRAP_ARGV:goose|${gooseStub}|--x`)
    },
)

test('createTerminalSession spawns a shell that echoes stdin to stdout', async () => {
    const cwd = tmp()
    const s = createTerminalSession({
        cwd,
        shell: '/bin/sh',
        cols: 80,
        rows: 24,
    })
    try {
        const out: Buffer[] = []
        s.pty.onData(d => out.push(Buffer.from(d)))
        s.pty.write('echo hi-from-test\n')
        // Wait for the echo. Poll up to 2s.
        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
            if (Buffer.concat(out).toString().includes('hi-from-test')) break
            await new Promise(r => setTimeout(r, 25))
        }
        expect(Buffer.concat(out).toString()).toContain('hi-from-test')
    } finally {
        killSession(s.id)
    }
})

test('resizeSession updates the PTY winsize and propagates to the shell', async () => {
    const cwd = tmp()
    const s = createTerminalSession({
        cwd,
        shell: '/bin/sh',
        cols: 80,
        rows: 24,
    })
    try {
        const out: Buffer[] = []
        s.pty.onData(d => out.push(Buffer.from(d)))
        resizeSession(s.id, 120, 40)
        expect(s.cols).toBe(120)
        expect(s.rows).toBe(40)
        s.pty.write('stty size\n')
        const deadline = Date.now() + 2000
        while (Date.now() < deadline) {
            if (/\b40\s+120\b/.test(Buffer.concat(out).toString())) break
            await new Promise(r => setTimeout(r, 25))
        }
        expect(Buffer.concat(out).toString()).toMatch(/\b40\s+120\b/)
    } finally {
        killSession(s.id)
    }
})

// Regression: GET /agent-graph used to be the only caller of relay.ts's prune(), so closing a
// terminal tab left its relay-registered session (and its whole subagent subtree) in the
// registry forever once that route was removed (the agents graph). killSession now calls
// prune() itself — this is the natural "terminal tab closed" hook relay.ts's own doc comment
// says doesn't otherwise exist.
test("killSession prunes the closed tab's session out of the relay registry", () => {
    resetRelay()
    const cwd = tmp()
    const s = createTerminalSession({
        cwd,
        shell: '/bin/sh',
        cols: 80,
        rows: 24,
    })
    try {
        registerSession({
            sessionId: 'sess-leak-test',
            terminalId: s.id,
            cwd: '/x',
        })
        expect(
            relaySnapshot().sessions.some(
                x => x.sessionId === 'sess-leak-test',
            ),
        ).toBe(true)
        killSession(s.id)
        expect(
            relaySnapshot().sessions.some(
                x => x.sessionId === 'sess-leak-test',
            ),
        ).toBe(false)
    } finally {
        resetRelay()
    }
})

test('killSession removes the session from the registry', () => {
    const cwd = tmp()
    const before = sessionCount()
    const s = createTerminalSession({
        cwd,
        shell: '/bin/sh',
        cols: 80,
        rows: 24,
    })
    try {
        expect(sessionCount()).toBe(before + 1)
    } finally {
        killSession(s.id)
    }
    expect(sessionCount()).toBe(before)
})

test('loginShellArgs launches a login shell', () => {
    expect(loginShellArgs()).toEqual(['-l'])
})

// The embedded terminal must see the same PATH a normal login terminal does — including
// entries set in ~/.zprofile (Homebrew/bun/nvm). This exercises the REAL shipped shim
// files (relay/shim/zdotdir/{.zshenv,.zprofile,.zshrc}) with a login zsh and a temp HOME
// whose only PATH entry lives in .zprofile, proving the shim re-sources it.
const SHIM_ZDOTDIR = join(
    import.meta.dir,
    '..',
    '..',
    'relay',
    'shim',
    'zdotdir',
)
const HAS_ZSH = existsSync('/bin/zsh')
test.if(HAS_ZSH && existsSync(SHIM_ZDOTDIR))(
    "login shell + shim .zprofile loads PATH set in the user's ~/.zprofile",
    async () => {
        const home = tmp()
        writeFileSync(
            join(home, '.zprofile'),
            'export PATH="/MARKER_ZPROFILE_BIN:$PATH"\n',
        )
        const proc = Bun.spawn(
            ['/bin/zsh', ...loginShellArgs(), '-i', '-c', 'echo $PATH'],
            {
                env: {
                    HOME: home,
                    ZDOTDIR: SHIM_ZDOTDIR,
                    PATH: '/usr/bin:/bin',
                    TERM: 'dumb',
                },
                stdout: 'pipe',
                stderr: 'ignore',
            },
        )
        const out = await new Response(proc.stdout).text()
        await proc.exited
        expect(out).toContain('/MARKER_ZPROFILE_BIN')
    },
)
