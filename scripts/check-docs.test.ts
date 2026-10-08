import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    mdLinks,
    citedScripts,
    workspaceDirs,
    definedScripts,
    missingScripts,
    unmentionedWorkspaces,
    slug,
    headingSlugs,
    anchorLinks,
    historyLines,
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

// --- mdLinks ----------------------------------------------------------------------------------

test('a real relative link is extracted, anchor stripped', () => {
    expect(mdLinks('see [x](../bases/overview.md#sources) here')).toEqual([
        '../bases/overview.md',
    ])
})

test('a link inside an inline code span is an example, not a link', () => {
    expect(mdLinks('| `[t](Other%20Note.md)` | no graph edge |')).toEqual([])
})

test('a link inside a fenced block is skipped, one after the fence is not', () => {
    expect(mdLinks('```md\n[a](a.md)\n```\n[b](b.md)\n')).toEqual(['b.md'])
})

test('backticked link TEXT does not hide the link target', () => {
    expect(mdLinks('[`tasks.md`](guide/tasks.md)')).toEqual(['guide/tasks.md'])
})

// --- anchors ----------------------------------------------------------------------------------

test('slug follows GitHub: code and punctuation dropped, spaces to dashes', () => {
    expect(slug('Recurrence engine (`recurrence.ts`)')).toBe(
        'recurrence-engine-recurrencets',
    )
    expect(slug('`==` and `!=` equality')).toBe('and-equality')
})

test('a GitHub double-dash anchor and a collapsed one compare equal', () => {
    expect(slug('-and--equality')).toBe(slug('`==` and `!=` equality'))
})

test('repeated headings get -1, -2 suffixes; headings in fences are not headings', () => {
    const md = '# Title\n## Example\n```md\n## Not a heading\n```\n## Example\n'
    expect([...headingSlugs(md)]).toEqual(['title', 'example', 'example-1'])
})

test('anchorLinks finds page and same-page anchors, skips urls and code', () => {
    const md =
        '[a](x.md#one) [b](#two) [c](https://e.com/x.md#three) `[d](y.md#four)`'
    expect(anchorLinks(md)).toEqual([
        { target: 'x.md', anchor: 'one' },
        { target: '', anchor: 'two' },
    ])
})

// --- history lint -----------------------------------------------------------------------------

test('history words in prose are flagged with their line', () => {
    const hits = historyLines('# T\nThe flag is read.\nThe old flag is no longer read.\n')
    expect(hits.map(h => h.line)).toEqual([3])
})

test('history words inside code are not flagged', () => {
    expect(historyLines('```\n// legacy path\n```\nuse `legacyKey`\n')).toEqual([])
})

test('issue numbers and commit hashes are flagged, hex colours in code are not', () => {
    expect(historyLines('fixed in (#103)').length).toBe(1)
    expect(historyLines('removed in commit a6687c0').length).toBe(1)
    expect(historyLines('the colour `#103`').length).toBe(0)
})
