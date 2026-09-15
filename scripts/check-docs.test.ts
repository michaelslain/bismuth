import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    citedScripts,
    workspaceDirs,
    definedScripts,
    missingScripts,
    unmentionedWorkspaces,
} from './check-docs'

// --- citedScripts -----------------------------------------------------------------------------

test('a file-path token is skipped', () => {
    expect(citedScripts('run it with `bun run core/src/server.ts`')).toEqual([])
})

test('a token with a flag after it is still extracted', () => {
    expect(citedScripts('use `bun run verify --port 6007` to check')).toEqual([
        'verify',
    ])
})

test('a `--` token is skipped', () => {
    expect(citedScripts('`bun run -- --port 6007`')).toEqual([])
})

test('a token starting with a flag is skipped', () => {
    expect(citedScripts('`bun run --pretty`')).toEqual([])
})

test('a .js file-path token is skipped', () => {
    expect(citedScripts('`bun run scripts/build.js`')).toEqual([])
})

test('a plain script token is extracted', () => {
    expect(citedScripts('run `bun run typecheck` before pushing')).toEqual([
        'typecheck',
    ])
})

test('multiple citations across the text are all extracted, in order', () => {
    expect(
        citedScripts('first `bun run gate` then `bun run typecheck`'),
    ).toEqual(['gate', 'typecheck'])
})

// --- definedScripts / workspaceDirs / missingScripts -------------------------------------------

function makeRepo() {
    const root = mkdtempSync(join(tmpdir(), 'check-docs-'))
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            name: 'root',
            workspaces: ['core', 'app'],
            scripts: { typecheck: 'tsc --noEmit', gate: 'bun run scripts/gate.ts' },
        }),
    )
    mkdirSync(join(root, 'core'))
    writeFileSync(
        join(root, 'core', 'package.json'),
        JSON.stringify({ name: 'core', scripts: { 'core:serve': 'bun run src/server.ts' } }),
    )
    mkdirSync(join(root, 'app'))
    writeFileSync(
        join(root, 'app', 'package.json'),
        JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }),
    )
    return root
}

test('workspaceDirs reads the plain directory names from root package.json', () => {
    const root = makeRepo()
    expect(workspaceDirs(root)).toEqual(['core', 'app'])
})

test('workspaceDirs expands a trailing "/*" glob into that directory\'s subdirectories', () => {
    const root = mkdtempSync(join(tmpdir(), 'check-docs-'))
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    )
    mkdirSync(join(root, 'packages'), { recursive: true })
    mkdirSync(join(root, 'packages', 'foo'))
    mkdirSync(join(root, 'packages', 'bar'))
    expect(workspaceDirs(root)).toEqual(['packages/foo', 'packages/bar'])
})

test('a script defined only in a workspace package.json counts as defined', () => {
    const root = makeRepo()
    const defined = definedScripts(root)
    expect(defined.has('core:serve')).toBe(true)
    expect(defined.has('dev')).toBe(true)
    expect(defined.has('typecheck')).toBe(true)
})

test('a missing script is reported', () => {
    const root = makeRepo()
    const defined = definedScripts(root)
    expect(
        missingScripts(['typecheck', 'core:serve', 'nonexistent'], defined),
    ).toEqual(['nonexistent'])
})

test('missingScripts dedupes repeated misses', () => {
    const root = makeRepo()
    const defined = definedScripts(root)
    expect(missingScripts(['ghost', 'ghost'], defined)).toEqual(['ghost'])
})

// --- unmentionedWorkspaces ----------------------------------------------------------------------

test('workspace parity catches an unmentioned dir', () => {
    expect(unmentionedWorkspaces('this text mentions core only', ['core', 'app'])).toEqual([
        'app',
    ])
})

test('workspace parity does not false-positive on a substring match', () => {
    // "application" contains "app" as a substring, but not as a whole word — must still miss.
    expect(
        unmentionedWorkspaces('this is our application layer', ['app']),
    ).toEqual(['app'])
})

test('workspace parity passes when the whole word is present', () => {
    expect(unmentionedWorkspaces('the app workspace lives at app/', ['app'])).toEqual(
        [],
    )
})
