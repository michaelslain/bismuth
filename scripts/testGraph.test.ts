// Which tests a change selects (scripts/testGraph.ts), over small in-memory repos, plus pins on the
// real repo for the cases a mutation sweep found.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
    alwaysTests,
    buildGraph,
    foldPath,
    parsePathLiterals,
    selectTests,
    snapshotRepo,
    type RepoSnapshot,
} from './testGraph'

/** A repo of `files` (path → source). Non-code files get empty text. Nothing on disk, so Bun's
 *  resolver misses and the module's own resolver answers. */
function repo(files: Record<string, string>): RepoSnapshot {
    const text = new Map(
        Object.entries(files).filter(([p]) => /\.(ts|tsx|js|mjs)$/.test(p)),
    )
    return {
        root: '/nonexistent-bismuth-test-repo',
        paths: new Set(Object.keys(files)),
        text,
        packages: new Map(),
    }
}

function pick(files: Record<string, string>, changed: string[]) {
    const g = buildGraph(repo(files))
    const s = selectTests(changed, g, alwaysTests(g))
    return s.all ? 'ALL' : s.files
}

describe('selectTests', () => {
    test('an import selects every test that reaches the file, through any chain and workspace', () => {
        const files = {
            'core/src/a.ts': 'export const a = 1',
            'core/src/b.ts': "import { a } from './a'\nexport const b = a",
            'core/test/b.test.ts': "import { b } from '../src/b'",
            'cli/test/c.test.ts': "import { b } from '../../core/src/b'",
            'core/test/other.test.ts': "import 'bun:test'",
        }
        expect(pick(files, ['core/src/a.ts'])).toEqual([
            'cli/test/c.test.ts',
            'core/test/b.test.ts',
        ])
    })

    test('a changed test file selects itself', () => {
        expect(
            pick({ 'core/test/x.test.ts': '' }, ['core/test/x.test.ts']),
        ).toEqual(['core/test/x.test.ts'])
    })

    test('a shared root file selects everything', () => {
        for (const f of [
            'package.json',
            'bun.lock',
            'tsconfig.base.json',
            'bunfig.toml',
            'scripts/x.ts',
        ])
            expect(pick({ 'core/test/x.test.ts': '' }, [f])).toBe('ALL')
    })

    test('a spawned entry point named by a root-relative literal is a dependency', () => {
        const files = {
            'cli/src/index.ts': '',
            'cli/test/e2e.test.ts':
                "Bun.spawn(['bun', 'run', 'cli/src/index.ts'])",
        }
        expect(pick(files, ['cli/src/index.ts'])).toEqual([
            'cli/test/e2e.test.ts',
        ])
    })

    test("a template's literal tail names a file: `${repoRoot}/cli/src/index.ts`", () => {
        expect(
            parsePathLiterals('[`${repoRoot}/cli/src/index.ts`, x]'),
        ).toEqual(['cli/src/index.ts'])
        const files = {
            'cli/src/index.ts': '',
            'mcp/src/cli.ts':
                'export const run = (r: string) => Bun.spawn([`${r}/cli/src/index.ts`])',
            'mcp/test/cli.test.ts': "import { run } from '../src/cli'",
        }
        expect(pick(files, ['cli/src/index.ts'])).toEqual([
            'mcp/test/cli.test.ts',
        ])
    })

    test('a path built from import.meta.dir is evaluated, through a bound name too', () => {
        const files = {
            'cli/src/index.ts': '',
            'core/test/support/fake.ts': '',
            'cli/test/a.test.ts':
                "const CLI = join(import.meta.dir, '..', 'src', 'index.ts')\nBun.spawn([CLI])",
            'core/test/b.test.ts':
                "const ROOT = join(import.meta.dir, '..', '..')\nBun.spawn([join(ROOT, 'core/test/support/fake.ts')])",
        }
        expect(pick(files, ['cli/src/index.ts'])).toEqual([
            'cli/test/a.test.ts',
        ])
        expect(pick(files, ['core/test/support/fake.ts'])).toEqual([
            'core/test/b.test.ts',
        ])
    })

    test('a directory read by an fs call selects the test for any file under it, a new one too', () => {
        const files = {
            'app/src/ui/Button.tsx': '',
            'app/src/ui/scan.test.ts':
                "const SRC = join(import.meta.dir, '..')\nfunction walk(dir) {\n  return readdirSync(dir)\n}\nconst all = walk(SRC)",
        }
        expect(pick(files, ['app/src/ui/Button.tsx'])).toEqual([
            'app/src/ui/scan.test.ts',
        ])
        expect(pick(files, ['app/src/brand-new.tsx'])).toEqual([
            'app/src/ui/scan.test.ts',
        ])
    })

    test('a read through a path that does not fold makes the test always-run', () => {
        const files = {
            'core/src/a.ts': '',
            'core/src/b.ts': "import './a'",
            'core/test/odd.test.ts': 'readFileSync(pick(import.meta.dir))',
            'core/test/plain.test.ts': "import 'bun:test'",
        }
        expect(pick(files, ['core/src/a.ts'])).toEqual([
            'core/test/odd.test.ts',
        ])
    })

    test('a read of a temp path is not a repo read', () => {
        const files = {
            'core/src/a.ts': '',
            'core/src/b.ts': "import './a'",
            'core/test/tmp.test.ts':
                "const REPO = join(import.meta.dir, '..')\nconst vault = mkdtempSync('x')\nreadFileSync(join(vault, 'n.md'))",
        }
        expect(pick(files, ['core/src/a.ts'])).toEqual([])
    })

    test('a workspace file nothing loads, names or reads selects its whole workspace', () => {
        const files = {
            'core/test/fixtures/v.md': '',
            'core/test/a.test.ts': '',
            'core/test/b.test.ts': '',
            'cli/test/c.test.ts': '',
        }
        expect(pick(files, ['core/test/fixtures/v.md'])).toEqual([
            'core/test/a.test.ts',
            'core/test/b.test.ts',
        ])
    })

    test('a file imported only by non-test code selects nothing beyond the always-run tests', () => {
        const files = {
            'app/src/X.module.css': '',
            'app/src/X.tsx': "import s from './X.module.css'",
            'app/src/y.test.ts': "import 'bun:test'",
        }
        expect(pick(files, ['app/src/X.module.css'])).toEqual([])
    })

    test('deleting a file still selects the tests that import it', () => {
        const files = {
            'core/test/a.test.ts': "import { gone } from '../src/gone'",
        }
        expect(pick(files, ['core/src/gone.ts'])).toEqual([
            'core/test/a.test.ts',
        ])
    })

    test('mock.module targets are dependencies; a path named only in a comment is not', () => {
        const files = {
            'daemon/src/platform.ts': '',
            'core/src/a.ts': '',
            'cli/test/m.test.ts':
                "// see core/src/a.ts for why\nmock.module('../../daemon/src/platform', () => ({}))",
        }
        expect(pick(files, ['daemon/src/platform.ts'])).toEqual([
            'cli/test/m.test.ts',
        ])
        expect(pick(files, ['core/src/a.ts'])).toEqual([])
    })
})

describe('foldPath', () => {
    const names = new Map([['REPO_ROOT', '']])
    const fold = (e: string) => foldPath(e, 'cli/test/a.test.ts', names)
    test('join, resolve, templates, + and URL fold to repo paths', () => {
        expect(fold("join(import.meta.dir, '..', 'src', 'index.ts')")).toEqual({
            path: 'cli/src/index.ts',
            under: false,
        })
        expect(fold("join(REPO_ROOT, 'docs/x.md')")).toEqual({
            path: 'docs/x.md',
            under: false,
        })
        expect(fold('`${import.meta.dir}/fixtures/a.pdf`')).toEqual({
            path: 'cli/test/fixtures/a.pdf',
            under: false,
        })
        expect(fold("__dirname + '/x.ts'")).toEqual({
            path: 'cli/test/x.ts',
            under: false,
        })
        expect(fold("new URL('./y.ts', import.meta.url)")).toEqual({
            path: 'cli/test/y.ts',
            under: false,
        })
    })

    test('a computed tail keeps the literal prefix, marked as somewhere under it', () => {
        expect(fold("join(REPO_ROOT, 'docs', name)")).toEqual({
            path: 'docs',
            under: true,
        })
    })

    test('a path leaving the repo, or one with no location, does not fold', () => {
        expect(fold("join(import.meta.dir, '../../..')")).toBeUndefined()
        expect(fold("join(tmp, 'x')")).toBeUndefined()
    })
})

describe('the real repo', () => {
    const g = buildGraph(snapshotRepo(join(import.meta.dir, '..')))
    const sel = (f: string) => {
        const s = selectTests([f], g, alwaysTests(g))
        return s.all ? [] : s.files
    }

    test('a CLI command selects the CLI suites and the MCP bridge that spawns the CLI', () => {
        const s = sel('cli/src/commands/calendar.ts')
        expect(s).toContain('cli/test/cliCalendar.test.ts')
        expect(s).toContain('mcp/test/cli.test.ts')
    })

    test('the source-scanning guards run for any app source change', () => {
        expect(sel('app/src/brand-new-file.tsx')).toContain(
            'app/src/ui/oneButton.test.ts',
        )
    })
})
