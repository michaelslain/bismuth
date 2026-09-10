// Guards the 2026-09-09 build regression: a VALUE import of a node-coupled core module
// (core/src/files.ts, reached via core/src/fileAccess.ts's `node:fs`/`node:path` deps) broke
// `vite build` with `"resolve" is not exported by "__vite-browser-external"` — but NEITHER
// `bun test app` NOR `bun run typecheck` noticed, because both run under Bun's own
// Node-compatible runtime, where `node:path` resolves fine. Only Rollup's browser
// externalization sees the problem, and nobody runs a full production build on every commit.
//
// This is the cheap stand-in: a static, regex-based import-graph walk (NOT a real bundler —
// it does not resolve npm packages, TS path aliases, or barrel re-export chains beyond a
// single `export … from`) that starts from app/src/index.tsx — the ONE file `index.html`
// actually loads (`<script src="/src/index.tsx">`), i.e. the real `vite build` entry — and
// fails FAST if a VALUE-import path (static `import`, `export … from`, or a dynamic
// `import(...)` call — Vite still transforms a dynamically-imported chunk at build time, so a
// dynamic import is exactly as dangerous here as a static one) reaches core/src/files.ts, or
// any bare `node:*` builtin.
//
// Rooting at every app/src file instead of the real entry was tried first and false-positived
// on app/src/mobile/bootMobile.ts, which — per its own header comment — is a real, deliberate
// integration point for a MOBILE `index.tsx` that does not exist yet; today's desktop
// `index.tsx` "never imports this module". A file unreached from the real entry cannot break
// `vite build` regardless of what it imports, so it must not fail this test either. If
// bootMobile.ts (or anything else) is ever wired into an entry that IS built, this walk picks
// it up automatically — no change needed here.
//
// It does not replace `cd app && bun run build` as ground truth for "does the app actually
// build" — see that command for the real Rollup error and line number. It exists so the same
// CLASS of regression (a future value import of a node-coupled core module from app code) is
// caught in milliseconds, inside the suite that already runs on every commit, instead of only
// showing up whenever someone next happens to run a production build.
import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const APP_SRC = join(REPO_ROOT, 'app/src')
const CORE_SRC = join(REPO_ROOT, 'core/src')

/** The one hazard this test exists for by name — see core/src/taskParse.ts's header for the
 *  incident this guards. */
const FORBIDDEN_FILE = join(CORE_SRC, 'files.ts')

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
    }
    return out
}

/** A named-import list that is ENTIRELY `type X` entries is erased at build — no different
 *  from a leading `import type`. A list with even one bare (non-type) name is a real value
 *  import of the module, even if some of its siblings are type-only. */
function isAllTypeNamedImport(braceContents: string): boolean {
    const items = braceContents.split(',').map(s => s.trim()).filter(Boolean)
    return items.length > 0 && items.every(i => /^type\s+\S/.test(i))
}

/** Value-import specifiers only. `import type …`/`export type …`, and named-import lists
 *  that are entirely `type X`, are skipped — matching what a bundler actually sees once
 *  TypeScript erases type-only imports.
 *
 *  Operates on the WHOLE file text, not line-by-line: this codebase writes long named-import
 *  lists across several lines (brace on the `import` line, `} from '…'` on its own line —
 *  `taskScope.ts`'s own `import {\n    normalizeStoredTaskRow,\n    taskToRow,\n} from …` is a
 *  real example), and a per-line scan silently drops every one of those edges. Every pattern
 *  below is anchored to the START of a line (the `m` flag's `^`) specifically so it cannot
 *  false-match the word "import"/"export" appearing mid-sentence in a comment — every comment
 *  line in this codebase is prefixed with `//` or ` * `, so a real statement is the only thing
 *  that starts a line with these keywords. */
function valueImportSpecifiers(file: string): string[] {
    const text = readFileSync(file, 'utf8')
    const specs: string[] = []

    // `import <clause> from '<spec>'` — clause may span multiple lines. Non-greedy so this
    // does not swallow past the first `from '...'` it finds.
    for (const m of text.matchAll(
        /^import\s+(type\s+)?([\s\S]*?)\s*from\s+(['"])([^'"]+)\3/gm,
    )) {
        const [, isTypeOnly, clause, , spec] = m
        if (isTypeOnly) continue
        const braces = clause.match(/^\{([\s\S]*)\}$/)
        if (braces && isAllTypeNamedImport(braces[1])) continue
        specs.push(spec)
    }

    // Side-effect-only imports: `import '<spec>'` (no `from`). None target a .ts/.tsx module
    // today (only .css), but resolveSpecifier is a no-op for anything that doesn't resolve to
    // a real file, so including this costs nothing and covers the shape if it ever appears.
    for (const m of text.matchAll(/^import\s+(['"])([^'"]+)\1/gm)) specs.push(m[2])

    // `export { … } from '<spec>'` / `export * from '<spec>'` — a real re-export, which does
    // carry a value edge. `export type { … } from '<spec>'` does not.
    for (const m of text.matchAll(
        /^export\s+(type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+(['"])([^'"]+)\2/gm,
    )) {
        const [, isTypeOnly, , spec] = m
        if (!isTypeOnly) specs.push(spec)
    }

    // Dynamic import() calls anywhere in the file (not just line-initial — they legitimately
    // appear mid-expression, e.g. `Promise.all([import('./a'), import('./b')])`). Vite still
    // transforms a dynamically-imported chunk at build time, so it is just as much a value
    // edge as a static import for this check — that is exactly how files.ts got pulled in via
    // fileAccess.ts's own lazy `await import('./files')`, once anything reached fileAccess.ts.
    for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g))
        specs.push(m[1])

    return specs
}

function resolveSpecifier(fromFile: string, spec: string): string | 'node' | null {
    if (spec.startsWith('node:')) return 'node'
    if (!spec.startsWith('.')) return null // npm package / workspace alias — out of scope
    const base = resolve(dirname(fromFile), spec)
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, 'index.ts'),
        join(base, 'index.tsx'),
    ]
    return (
        candidates.find(c => existsSync(c) && statSync(c).isFile()) ?? null
    )
}

test('the real vite entry graph has no value-import path to core/src/files.ts or a bare node: module', () => {
    const roots = [join(APP_SRC, 'index.tsx')]
    const universe = [
        ...walk(APP_SRC).filter(f => !/\.(test|stories)\.tsx?$/.test(f)),
        ...walk(CORE_SRC),
    ]
    const edges = new Map<string, string[]>()
    for (const f of universe) edges.set(f, valueImportSpecifiers(f))

    const seen = new Set<string>()
    const queue: Array<{ file: string; path: string[] }> = roots.map(f => ({
        file: f,
        path: [f],
    }))
    let offenderPath: string[] | null = null
    let offenderKind: 'files.ts' | 'node:' | null = null

    while (queue.length) {
        const { file, path } = queue.shift()!
        if (seen.has(file)) continue
        seen.add(file)
        for (const spec of edges.get(file) ?? []) {
            const resolved = resolveSpecifier(file, spec)
            if (resolved === null) continue
            if (resolved === 'node') {
                if (!offenderPath) {
                    offenderPath = [...path, spec]
                    offenderKind = 'node:'
                }
                continue
            }
            if (resolved === FORBIDDEN_FILE) {
                offenderPath = [...path, resolved]
                offenderKind = 'files.ts'
                break
            }
            if (!seen.has(resolved))
                queue.push({ file: resolved, path: [...path, resolved] })
        }
        if (offenderKind === 'files.ts') break
    }

    const rel = (p: string) => relative(REPO_ROOT, p)
    if (offenderPath) {
        const what =
            offenderKind === 'files.ts'
                ? 'core/src/files.ts (the desktop node:fs/node:path file-IO module)'
                : `a bare "${offenderPath[offenderPath.length - 1]}" import`
        throw new Error(
            `app/src has a value-import path to ${what} — this breaks \`vite build\` ` +
                `("resolve" is not exported by "__vite-browser-external") even though ` +
                `typecheck and bun test app both stay green. Path:\n  ` +
                offenderPath
                    .slice(0, -1)
                    .map(rel)
                    .concat(
                        offenderKind === 'files.ts'
                            ? rel(offenderPath[offenderPath.length - 1])
                            : offenderPath[offenderPath.length - 1],
                    )
                    .join('\n  -> '),
        )
    }
    expect(offenderPath).toBeNull()
})
