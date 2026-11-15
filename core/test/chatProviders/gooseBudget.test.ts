// Which goose profile a local-model chat runs, from the loaded window (gooseBudget.ts).
import { afterAll, describe, expect, test } from 'bun:test'
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    ensureGooseLeanHome,
    GOOSE_LEAN_EXTENSIONS,
    gooseProfileEnv,
    gooseWindowMessage,
    pickGooseProfile,
} from '../../src/chatProviders/acp/gooseBudget'
import { CHAT_GROWTH_TOKENS } from '../../src/chatProviders/opencode/opencodeBudget'

// Opening sizes measured on a machine with 194 Claude agents and 49 skills (goose 1.59.1).
const opening = { full: 21_600, lean: 8_100 }

describe('pickGooseProfile', () => {
    test('a window with room for the full opening and a first exchange runs full', () => {
        const window = opening.full + 1_000 + CHAT_GROWTH_TOKENS
        expect(pickGooseProfile({ window, opening, extra: 1_000 })).toEqual({
            profile: 'full',
            fits: true,
            tokens: 22_600,
        })
    })

    test('a smaller window runs lean, which fits while its opening does', () => {
        expect(pickGooseProfile({ window: 16_384, opening, extra: 1_000 })).toMatchObject({
            profile: 'lean',
            fits: true,
        })
        expect(pickGooseProfile({ window: 9_100, opening, extra: 1_000 }).fits).toBe(true)
    })

    test('a window smaller than the lean opening does not fit', () => {
        expect(pickGooseProfile({ window: 4_096, opening, extra: 1_000 })).toEqual({
            profile: 'lean',
            fits: false,
            tokens: 9_100,
        })
    })
})

test('the lean profile keeps only the developer extension, through EXTENSIONS', () => {
    expect(gooseProfileEnv('full')).toEqual({})
    const env = gooseProfileEnv('lean', () => tmpdir())
    expect(Object.keys(JSON.parse(env.EXTENSIONS!))).toEqual(['developer'])
    expect(env.EXTENSIONS).toBe(GOOSE_LEAN_EXTENSIONS)
})

test('the too-small message names the window and the opening size', () => {
    const m = gooseWindowMessage({ model: 'qwen3.5:9b', window: 4096, tokens: 9_041 })
    expect(m).toContain('qwen3.5:9b')
    expect(m).toContain('4,096-token')
    expect(m).toContain('about 9,100 tokens')
})

describe('the lean profile home', () => {
    const made: string[] = []
    const temp = () => {
        const d = mkdtempSync(join(tmpdir(), 'goose-lean-home-'))
        made.push(d)
        return d
    }
    // the farm's top level is read-only after a build; open it again so the temp dir can go
    const open = (dest: string) => chmodSync(dest, 0o755)
    afterAll(() =>
        made.forEach(d => {
            for (const sub of readdirSync(d)) {
                try {
                    open(join(d, sub))
                } catch {}
            }
            rmSync(d, { recursive: true, force: true })
        }),
    )

    test('links every home entry except the skill and agent folders, and writes nothing to the real home', () => {
        const real = temp()
        for (const d of ['.claude', '.agents', '.config', '.local', 'Documents']) mkdirSync(join(real, d))
        writeFileSync(join(real, '.gitconfig'), '')
        const before = readdirSync(real).sort()
        const dest = join(temp(), 'goose-home')
        expect(ensureGooseLeanHome(real, dest)).toBe(dest)
        expect(readdirSync(dest).sort()).toEqual(['.config', '.gitconfig', '.local', 'Documents'])
        expect(readlinkSync(join(dest, '.config'))).toBe(join(real, '.config'))
        expect(readdirSync(real).sort()).toEqual(before)
    })

    test('rebuilds in place: a new entry appears, a removed one goes, a stale link is repointed', () => {
        const real = temp()
        const other = temp()
        mkdirSync(join(real, 'a'))
        const dest = join(temp(), 'goose-home')
        ensureGooseLeanHome(real, dest)
        mkdirSync(join(real, 'b'))
        rmSync(join(real, 'a'), { recursive: true })
        ensureGooseLeanHome(real, dest)
        expect(readdirSync(dest)).toEqual(['b'])
        open(dest)
        rmSync(join(dest, 'b'))
        symlinkSync(other, join(dest, 'b'))
        ensureGooseLeanHome(real, dest)
        expect(readlinkSync(join(dest, 'b'))).toBe(join(real, 'b'))
        expect(lstatSync(join(dest, 'b')).isSymbolicLink()).toBe(true)
    })

    test('the lean env points HOME at it and pins BISMUTH_HOME; the full env adds nothing', () => {
        const home = temp()
        const env = gooseProfileEnv('lean', () => home)
        expect(env.HOME).toBe(home)
        expect(env.BISMUTH_HOME).toBeTruthy()
        expect(gooseProfileEnv('full', () => home)).toEqual({})
    })

    test('a real file in the farm survives a rebuild', () => {
        const real = temp()
        mkdirSync(join(real, 'a'))
        const dest = join(temp(), 'goose-home')
        ensureGooseLeanHome(real, dest)
        open(dest)
        writeFileSync(join(dest, 'todo.md'), 'from goose')
        ensureGooseLeanHome(real, dest)
        expect(existsSync(join(dest, 'todo.md'))).toBe(true)
        expect(readdirSync(dest).sort()).toEqual(['a', 'todo.md'])
    })

    test('a real directory in the farm does not make the rebuild throw, and HOME stays set', () => {
        const real = temp()
        mkdirSync(join(real, 'a'))
        mkdirSync(join(real, '.npm'))
        const dest = join(temp(), 'goose-home')
        ensureGooseLeanHome(real, dest)
        open(dest)
        rmSync(join(dest, '.npm'))
        mkdirSync(join(dest, '.npm'))
        mkdirSync(join(dest, 'scratch'))
        expect(() => ensureGooseLeanHome(real, dest)).not.toThrow()
        expect(lstatSync(join(dest, '.npm')).isDirectory()).toBe(true)
        expect(lstatSync(join(dest, 'scratch')).isDirectory()).toBe(true)
        expect(gooseProfileEnv('lean', () => ensureGooseLeanHome(real, dest)).HOME).toBe(dest)
    })

    test('a write at the top level of the farm fails after the build', () => {
        if (process.getuid?.() === 0) return // root ignores the mode
        const real = temp()
        mkdirSync(join(real, 'a'))
        const dest = join(temp(), 'goose-home')
        ensureGooseLeanHome(real, dest)
        expect(() => writeFileSync(join(dest, 'todo.md'), 'x')).toThrow()
        expect(existsSync(join(dest, 'todo.md'))).toBe(false)
    })
})
