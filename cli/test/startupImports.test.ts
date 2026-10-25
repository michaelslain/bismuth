// Every `bismuth` invocation evaluates the CLI's static import graph before it does anything, so a
// heavy module reached statically from cli/src/index.ts adds its load time to every command,
// every agent `bismuth_cli` call and every spawned CLI in the test suite. These load on use
// (`await import(…)` in the command that needs them) instead.
import { expect, test } from 'bun:test'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

/** Modules that each add tens of milliseconds to a CLI start. */
const LOAD_ON_USE = [
    'core/src/drawing/export.ts',
    'core/src/drawing/pdfHighlightText.ts',
    'core/src/server.ts',
    'daemon/src/daemon/emailTransport.ts',
]

/** Repo files reachable from `entry` through static imports only (dynamic `import()` excluded). */
async function staticClosure(entry: string): Promise<Set<string>> {
    const loaders = {
        ts: new Bun.Transpiler({ loader: 'ts' }),
        tsx: new Bun.Transpiler({ loader: 'tsx' }),
    }
    const seen = new Set<string>([entry])
    const queue = [entry]
    while (queue.length) {
        const file = queue.pop()!
        if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
        const src = await Bun.file(join(ROOT, file)).text()
        const ts = file.endsWith('.tsx') ? loaders.tsx : loaders.ts
        for (const imp of ts.scanImports(src)) {
            if (imp.kind === 'dynamic-import') continue
            let abs: string
            try {
                abs = Bun.resolveSync(imp.path, join(ROOT, dirname(file)))
            } catch {
                continue
            }
            if (!abs.startsWith(ROOT + '/') || abs.includes('/node_modules/')) continue
            const rel = abs.slice(ROOT.length + 1)
            if (!seen.has(rel)) {
                seen.add(rel)
                queue.push(rel)
            }
        }
    }
    return seen
}

test('the CLI entry point reaches none of the load-on-use modules through static imports', async () => {
    const closure = await staticClosure('cli/src/index.ts')
    expect(closure.has('cli/src/commands/draw.ts')).toBe(true)
    expect(LOAD_ON_USE.filter(m => closure.has(m))).toEqual([])
})
