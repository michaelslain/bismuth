// `memory` is an always-safe command in the CLI gate, so it protects itself: an agent (either entry
// path) may not overwrite or forget a hidden memory note, and recall never shows one. The owner may,
// and `remember` keeps the note's `visibility:` frontmatter.
import { test, expect, beforeAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { makeLeakVault, runCli } from './visibilityLeak'

const TIMEOUT = 30_000
const REFUSAL = 'refused: that memory note is not visible to this agent'

let vault: string
let mem: string
const file = (name: string) => join(mem, `${name}.md`)

function seed(name: string, visibility?: 'hidden' | 'chat-only', body = 'SECRETTOKEN') {
    writeFileSync(
        file(name),
        `---\ntype: fact\ntags: [a]\ncreated: 2026-01-01\nupdated: 2026-01-01${
            visibility ? `\nvisibility: ${visibility}` : ''
        }\n---\n\n${body}\n`,
    )
}

// An agent may only reach `<vault>/.daemon/memory`, so every test's graph lives there.
beforeAll(() => {
    vault = makeLeakVault().vault
    mem = join(vault, '.daemon', 'memory')
})
beforeEach(() => {
    rmSync(mem, { recursive: true, force: true })
    mkdirSync(mem, { recursive: true })
})

const AGENT_PATHS = [
    { channel: 'daemon', via: 'cli' },
    { channel: 'daemon', via: 'mcp' },
] as const

for (const opts of AGENT_PATHS) {
    test(
        `agent (${opts.channel} via ${opts.via}) remember over a hidden note is refused, file unchanged`,
        async () => {
            seed('secret', 'hidden')
            const before = readFileSync(file('secret'), 'utf8')
            const r = await runCli(
                ['memory', 'remember', '--name', 'secret', '--content', 'OVERWRITTEN', '--memory', mem],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(REFUSAL)
            expect(readFileSync(file('secret'), 'utf8')).toBe(before)
        },
        TIMEOUT,
    )

    test(
        `agent (${opts.channel} via ${opts.via}) forget of a hidden note is refused, file kept`,
        async () => {
            seed('secret', 'hidden')
            const r = await runCli(['memory', 'forget', 'secret', '--memory', mem], opts)
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(REFUSAL)
            expect(existsSync(file('secret'))).toBe(true)
        },
        TIMEOUT,
    )

    test(
        `agent (${opts.channel} via ${opts.via}) recall excludes hidden + chat-only, keeps the visible note`,
        async () => {
            seed('secret', 'hidden', 'SECRETTOKEN shared')
            seed('chatty', 'chat-only', 'CHATTYTOKEN shared')
            seed('open', undefined, 'OPENTOKEN shared')
            const r = await runCli(['memory', 'recall', 'shared', '--memory', mem], opts)
            expect(r.code).toBe(0)
            expect(r.stdout).toContain('OPENTOKEN')
            expect(r.stdout).not.toContain('SECRETTOKEN')
            expect(r.stdout).not.toContain('CHATTYTOKEN')
        },
        TIMEOUT,
    )
}

// ── spellings the memory package's own parser used to read as "no visibility" ───────────────────
// Core reads these as hidden (real YAML), so the agent must be refused whichever parser is asked.
const SPELLINGS: Array<[string, string]> = [
    ['quoted', 'visibility: "hidden"'],
    ['trailing comment', 'visibility: hidden # c'],
    ['value on the next line', 'visibility:\n  hidden'],
]

function seedRaw(name: string, visibilityLine: string, body: string) {
    writeFileSync(
        file(name),
        `---\ntype: fact\ntags: [a]\ncreated: 2026-01-01\nupdated: 2026-01-01\n${visibilityLine}\n---\n\n${body}\n`,
    )
}

for (const opts of AGENT_PATHS) {
    for (const [label, line] of SPELLINGS) {
        const who = `agent (${opts.channel} via ${opts.via}) vs a note with visibility ${label}`

        test(
            `${who}: recall excludes it, remember and forget are refused`,
            async () => {
                seedRaw('hq', line, 'MEMSECRET shared')
                seed('open', undefined, 'OPENTOKEN shared')
                const before = readFileSync(file('hq'), 'utf8')

                const rec = await runCli(['memory', 'recall', 'shared', '--memory', mem], opts)
                expect(rec.code).toBe(0)
                expect(rec.stdout).toContain('OPENTOKEN')
                expect(rec.stdout).not.toContain('MEMSECRET')

                const rem = await runCli(
                    ['memory', 'remember', '--name', 'hq', '--content', 'OVERWRITTEN', '--memory', mem],
                    opts,
                )
                expect(rem.code).not.toBe(0)
                expect(rem.stderr).toContain(REFUSAL)
                expect(readFileSync(file('hq'), 'utf8')).toBe(before)

                const fgt = await runCli(['memory', 'forget', 'hq', '--memory', mem], opts)
                expect(fgt.code).not.toBe(0)
                expect(fgt.stderr).toContain(REFUSAL)
                expect(existsSync(file('hq'))).toBe(true)
            },
            TIMEOUT,
        )
    }
}

test(
    'agent remember over a visible note still works',
    async () => {
        seed('open', undefined, 'OPENTOKEN')
        const r = await runCli(
            ['memory', 'remember', '--name', 'open', '--content', 'UPDATED', '--memory', mem],
            { channel: 'daemon', via: 'cli' },
        )
        expect(r.code).toBe(0)
        expect(readFileSync(file('open'), 'utf8')).toContain('UPDATED')
    },
    TIMEOUT,
)

test(
    'owner remember over a hidden note keeps visibility: hidden',
    async () => {
        seed('secret', 'hidden')
        const r = await runCli(
            ['memory', 'remember', '--name', 'secret', '--content', 'OWNEREDIT', '--memory', mem],
            { channel: 'owner' },
        )
        expect(r.code).toBe(0)
        const raw = readFileSync(file('secret'), 'utf8')
        expect(raw).toContain('OWNEREDIT')
        expect(raw).toContain('visibility: hidden')
    },
    TIMEOUT,
)

test(
    'owner forget removes a hidden note',
    async () => {
        seed('secret', 'hidden')
        const r = await runCli(['memory', 'forget', 'secret', '--memory', mem], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(existsSync(file('secret'))).toBe(false)
    },
    TIMEOUT,
)

// ── confinement: an agent may not point --memory outside the vault's .daemon/memory ─────────────
// Memory visibility is per note, so `--memory <vault root>` would read, overwrite or delete notes in
// hidden FOLDERS that the per-note check cannot see.
const OUTSIDE =
    "refused: --memory outside the vault's .daemon/memory cannot be visibility-checked"

for (const opts of AGENT_PATHS) {
    const label = `agent (${opts.channel} via ${opts.via})`

    test(
        `${label} recall with --memory <vault root> is refused, no hidden-folder note printed`,
        async () => {
            const r = await runCli(['memory', 'recall', 'FOLDERTOKEN', '--memory', vault], opts)
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(OUTSIDE)
            expect(r.stdout).not.toContain('FOLDERTOKEN')
            expect(r.stdout).not.toContain('inner')
        },
        TIMEOUT,
    )

    test(
        `${label} forget with --memory <vault root> is refused, hidden-folder note kept`,
        async () => {
            const r = await runCli(
                ['memory', 'forget', 'inner', '--folder', 'Vault Hidden', '--memory', vault],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(OUTSIDE)
            const r2 = await runCli(
                ['memory', 'forget', 'Vault Hidden/inner', '--memory', vault],
                opts,
            )
            expect(r2.code).not.toBe(0)
            expect(r2.stderr).toContain(OUTSIDE)
            expect(existsSync(join(vault, 'Vault Hidden', 'inner.md'))).toBe(true)
        },
        TIMEOUT,
    )

    test(
        `${label} remember with --memory <vault root> is refused, hidden-folder note unchanged`,
        async () => {
            const target = join(vault, 'Vault Hidden', 'inner.md')
            const before = readFileSync(target, 'utf8')
            const r = await runCli(
                ['memory', 'remember', '--name', 'inner', '--folder', 'Vault Hidden', '--content', 'X', '--memory', vault],
                opts,
            )
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(OUTSIDE)
            expect(readFileSync(target, 'utf8')).toBe(before)
        },
        TIMEOUT,
    )

    test(
        `${label} --memory through a symlink out of the vault memory dir is refused`,
        async () => {
            const link = join(mem, 'escape')
            symlinkSync(vault, link)
            const r = await runCli(['memory', 'recall', 'FOLDERTOKEN', '--memory', link], opts)
            expect(r.code).not.toBe(0)
            expect(r.stderr).toContain(OUTSIDE)
        },
        TIMEOUT,
    )
}

test(
    'owner recall with --memory outside the vault memory dir is unchanged',
    async () => {
        const r = await runCli(['memory', 'recall', 'FOLDERTOKEN', '--memory', vault], { channel: 'owner' })
        expect(r.code).toBe(0)
        expect(r.stderr).not.toContain('refused')
    },
    TIMEOUT,
)
