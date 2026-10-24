// scripts/testGraph.ts
//
// Which test files a change can affect, from the repo's own dependency graph. The gates run this
// selection instead of whole workspaces: a change runs every test that can reach a changed file, in
// any workspace, and nothing that cannot. Every `bun test --parallel` file runs in a fresh global
// (`--isolate`), so a file's result depends only on what it loads and reads.
//
// A file depends on another when it:
//   - imports it, as Bun's parser sees the file (static, `export … from`, side-effect, literal
//     `import()`, `require`), or replaces it with `mock.module('…')`. Non-code targets count:
//     `./X.module.css`, `./doc.md?raw`, a JSON file;
//   - names it in a string literal, from its own directory or from the repo root
//     (`Bun.spawn(['bun', 'run', 'cli/src/index.ts', …])`);
//   - builds its path from a repo location: `join(import.meta.dir, '..', 'src', 'index.ts')`, or
//     `const ROOT = join(import.meta.dir, '../..')` and later `join(ROOT, 'docs/x.md')`. These are
//     evaluated statically. A directory that reaches an fs call (`readdirSync(SRC)`, a local
//     `walk(SRC)` that reads, `new Glob(…).scan({ cwd: SRC })`) depends on everything under it, so a
//     new file there selects the test too.
//
// Where the graph cannot see, the selection widens instead of guessing (see `selectTests`):
//   - a shared root file (package.json, bun.lock, tsconfig.base.json, bunfig.toml, scripts/,
//     .githooks/) selects everything;
//   - a changed file inside a workspace that nothing loads, names or reads (an entry point, a file
//     only reached through a path the evaluator cannot fold) selects that whole workspace;
//   - a test whose closure reads a repo location through a path that cannot be evaluated is an
//     "always" test and runs on every selection.
//
//   bun run scripts/testGraph.ts <changed path>...   # print the selection for these paths
import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, normalize } from 'node:path'

/** Root-level paths that can affect every test, so changing one selects all of them. */
export const SHARED_PREFIXES = [
    'package.json',
    'bun.lock',
    'tsconfig.base.json',
    'bunfig.toml',
    'scripts/',
    '.githooks/',
]

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/
const RESOLVE_SUFFIXES = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '/index.ts',
    '/index.tsx',
    '/index.js',
]
/** An expression that is a repo location: the file's own directory, or the cwd (the repo root
 *  under `bun test`). */
const LOCATION = /import\.meta\.(dir|dirname|url)|__dirname|process\.cwd\(\)/
/** Calls that read the filesystem or load a module by a path computed at run time. */
const FS_CALL =
    /(?<![\w$])(readFileSync|readdirSync|readFile|readdir|existsSync|statSync|lstatSync|Bun\.file|globSync|walkDir|Glob|scan|scanSync|import)\s*\(/g

export const isTestFile = (p: string): boolean => TEST_FILE.test(p)

const transpilers = new Map<string, Bun.Transpiler>()
const transpiler = (file: string): Bun.Transpiler => {
    const loader = /\.(tsx|jsx)$/.test(file)
        ? 'tsx'
        : /\.(js|mjs|cjs)$/.test(file)
          ? 'js'
          : 'ts'
    if (!transpilers.has(loader))
        transpilers.set(loader, new Bun.Transpiler({ loader }))
    return transpilers.get(loader)!
}

/** The file as Bun compiles it: no comments, no types. A path named only in a comment is no edge. */
export function stripComments(text: string, file = 'x.tsx'): string {
    try {
        return transpiler(file).transformSync(text)
    } catch {
        return text
    }
}

/** Module specifiers a file loads, by regex. The fallback for a file Bun's parser rejects. */
export function parseSpecifiersLoose(text: string): string[] {
    const out: string[] = []
    const re =
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bmock\.module\s*\(\s*)(['"])([^'"\n]+)\1/g
    for (const m of text.matchAll(re)) out.push(m[2])
    return out
}

/** Module specifiers a file loads, as Bun's own parser sees them (type-only imports are erased),
 *  plus `mock.module('…')` targets, which replace a module and so depend on it. */
export function parseSpecifiers(text: string, file = 'x.tsx'): string[] {
    const mocks = [
        ...text.matchAll(/\bmock\.module\s*\(\s*(['"])([^'"\n]+)\1/g),
    ].map(m => m[2])
    try {
        return [
            ...transpiler(file)
                .scanImports(text)
                .map(i => i.path),
            ...mocks,
        ]
    } catch {
        return parseSpecifiersLoose(text)
    }
}

/** String literals that look like a path to a file: contain a slash and end in an extension. A
 *  template's literal tail counts too: `${repoRoot}/cli/src/index.ts` names `cli/src/index.ts`. */
export function parsePathLiterals(text: string): string[] {
    const out: string[] = []
    for (const m of text.matchAll(
        /(['"`])([\w@.\-/]*\/[\w@.\-]+\.[a-z]{1,5})\1/g,
    ))
        out.push(m[2])
    for (const m of text.matchAll(
        /\}\/?([\w@.\-/]*[\w@.\-]+\.[a-z]{1,5})(?=[`$])/g,
    ))
        out.push(m[1])
    return out
}

// --- paths built from a repo location -------------------------------------------------------------

/** Split a call's argument text at its top-level commas. */
export function splitArgs(s: string): string[] {
    const out: string[] = []
    let depth = 0
    let quote = ''
    let cur = ''
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (quote) {
            if (c === '\\') {
                cur += c + s[++i]
                continue
            }
            if (c === quote) quote = ''
        } else if (c === "'" || c === '"' || c === '`') quote = c
        else if ('([{'.includes(c)) depth++
        else if (')]}'.includes(c)) depth--
        else if (c === ',' && depth === 0) {
            out.push(cur.trim())
            cur = ''
            continue
        }
        cur += c
    }
    if (cur.trim()) out.push(cur.trim())
    return out
}

/** A plain string literal's value (no `${}`), else undefined. */
export function stringValue(expr: string): string | undefined {
    const m = expr.trim().match(/^(['"`])([^'"`$\\]*)\1$/)
    return m ? m[2] : undefined
}

export type FoldedPath = {
    /** Repo-relative path; '' is the repo root. */
    path: string
    /** True when trailing non-literal parts were dropped: the value is somewhere under `path`. */
    under: boolean
}

const repoRelative = (p: string): string | undefined => {
    const n = normalize(p)
    if (n === '.' || n === './') return ''
    if (n.startsWith('..') || n.startsWith('/')) return undefined
    return n.replace(/\/$/, '')
}

/**
 * Evaluate an expression that builds a path from a repo location: a location token, a name bound to
 * one, `join`/`resolve` of those and string literals, a template or `+` concatenation, or
 * `new URL('…', import.meta.url)`. Literal parts after the first computed one are dropped and the
 * result is marked `under`.
 */
export function foldPath(
    expr: string,
    file: string,
    names: Map<string, string>,
): FoldedPath | undefined {
    const e = expr.trim().replace(/\.pathname$/, '')
    if (/^(import\.meta\.(dir|dirname)|__dirname)$/.test(e))
        return { path: dirname(file), under: false }
    if (/^process\.cwd\(\)$/.test(e)) return { path: '', under: false }
    if (names.has(e)) return { path: names.get(e)!, under: false }
    const url = e.match(
        /^new URL\(\s*(['"`])([^'"`$]*)\1\s*,\s*import\.meta\.url\s*\)$/,
    )
    if (url) {
        const p = repoRelative(join(dirname(file), url[2]))
        return p === undefined ? undefined : { path: p, under: false }
    }
    const call = e.match(/^(?:path\.|node_path\.)?(join|resolve)\(([\s\S]*)\)$/)
    if (call) {
        const [first, ...rest] = splitArgs(call[2])
        if (first === undefined) return undefined
        const base = foldPath(first, file, names)
        if (!base) return undefined
        let p = base.path
        let under = base.under
        for (const a of rest) {
            const lit = stringValue(a)
            if (lit === undefined || under) {
                under = true
                break
            }
            if (call[1] === 'resolve' && lit.startsWith('/')) return undefined
            p = join(p, lit)
        }
        const rel = repoRelative(p)
        return rel === undefined ? undefined : { path: rel, under }
    }
    const tpl = e.match(/^`\$\{([^}]+)\}([^`$]*)(\$\{)?[^`]*`$/)
    if (tpl) {
        const base = foldPath(tpl[1], file, names)
        if (!base) return undefined
        const rel = repoRelative(join(base.path, tpl[2]))
        return rel === undefined
            ? undefined
            : { path: rel, under: base.under || !!tpl[3] }
    }
    const plus = e.match(/^([\s\S]+?)\s*\+\s*(['"`])([^'"`$]*)\2([\s\S]*)$/)
    if (plus) {
        const base = foldPath(plus[1], file, names)
        if (!base) return undefined
        const rel = repoRelative(base.path + plus[3])
        return rel === undefined
            ? undefined
            : { path: rel, under: base.under || plus[4].trim() !== '' }
    }
    return undefined
}

/** Names a file binds to a repo path, to a fixed point: `const ROOT = join(import.meta.dir, '..')`,
 *  then `const DOCS = join(ROOT, 'docs')`. `inherited` holds names its imports export. */
export function foldedNames(
    code: string,
    file: string,
    inherited: Map<string, string> = new Map(),
): Map<string, string> {
    const names = new Map(inherited)
    const decls = [
        ...code.matchAll(
            /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g,
        ),
    ]
    for (let grew = true; grew;) {
        grew = false
        for (const [, name, init] of decls) {
            if (names.has(name)) continue
            const f = foldPath(init.replace(/[;,]\s*$/, ''), file, names)
            if (f && !f.under) {
                names.set(name, f.path)
                grew = true
            }
        }
    }
    return names
}

/** The argument text of each call `re` matches in `code`, up to its closing parenthesis. */
export function callArguments(code: string, re: RegExp): string[] {
    const out: string[] = []
    for (const m of code.matchAll(re)) {
        let depth = 1
        let i = m.index! + m[0].length
        const start = i
        for (; i < code.length && depth > 0 && i - start < 600; i++) {
            if (code[i] === '(') depth++
            else if (code[i] === ')') depth--
        }
        out.push(code.slice(start, depth === 0 ? i - 1 : i))
    }
    return out
}

/** Local functions whose body makes an fs call: `function walk(dir) { readdirSync(dir) … }`.
 *  A body runs from the declaration to the next top-level statement. */
export function fsFunctions(code: string): string[] {
    const lines = code.split('\n')
    const out: string[] = []
    const fs = new RegExp(FS_CALL.source)
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(
            /^\s*(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/,
        )
        if (!m) continue
        let j = i + 1
        while (
            j < lines.length &&
            !/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|describe|test|it)\b/.test(
                lines[j],
            )
        )
            j++
        if (fs.test(lines.slice(i, j).join('\n'))) out.push(m[1] ?? m[2])
    }
    return out
}

export type ComputedReads = {
    /** Existing files a folded path names, anywhere in the file (spawn targets, fixtures). */
    files: string[]
    /** Directories that reach an fs call: the file depends on everything under them. */
    dirs: string[]
    /** An fs call's path mentions a repo location but does not fold. */
    unresolved: boolean
}

const escapeRe = (s: string) => s.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&')

/** What a file reads or names through paths built from a repo location. */
export function computedReads(
    code: string,
    file: string,
    inherited: Map<string, string>,
    paths: Set<string>,
    dirs: Set<string>,
): ComputedReads {
    const names = foldedNames(code, file, inherited)
    const files = new Set<string>()
    const readDirs = new Set<string>()
    let unresolved = /\bls-files\b/.test(code)
    if (unresolved) readDirs.add('')
    const mentions = (s: string) =>
        LOCATION.test(s) ||
        [...names.keys()].some(n =>
            new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`).test(s),
        )
    // Every join/resolve/URL/template anywhere: an existing file it folds to is an edge.
    const exprs = [
        ...callArguments(
            code,
            /(?<![\w$.])(?:path\.)?(join|resolve)\s*\(/g,
        ).map(a => `join(${a})`),
        ...[...code.matchAll(/new URL\([^)]*import\.meta\.url\s*\)/g)].map(
            m => m[0],
        ),
        ...[...code.matchAll(/`\$\{[^`]*`/g)].map(m => m[0]),
    ]
    for (const x of exprs) {
        const f = foldPath(x, file, names)
        if (f && !f.under && paths.has(f.path)) files.add(f.path)
    }
    for (const p of names.values()) if (paths.has(p)) files.add(p)
    // fs calls, and calls of local functions that make one: what path reaches them.
    const walkers = fsFunctions(code)
    const callArgs = [
        ...callArguments(code, FS_CALL),
        ...(walkers.length
            ? callArguments(
                  code,
                  new RegExp(
                      `(?<![\\w$.])(${walkers.map(escapeRe).join('|')})\\s*\\(`,
                      'g',
                  ),
              )
            : []),
    ]
    for (const args of callArgs) {
        if (/^\s*['"`]/.test(args) && !args.trim().startsWith('`${')) continue
        const parts = splitArgs(args)
        const candidates = [
            ...parts,
            ...parts.flatMap(p =>
                [...p.matchAll(/\bcwd\s*:\s*([^,}]+)/g)].map(m => m[1]),
            ),
        ]
        let folded = false
        for (const c of candidates) {
            const f = foldPath(c, file, names)
            if (!f) continue
            folded = true
            if (!f.under && paths.has(f.path)) files.add(f.path)
            else if (f.path === '' || dirs.has(f.path)) readDirs.add(f.path)
        }
        if (!folded && mentions(args)) unresolved = true
    }
    return { files: [...files], dirs: [...readDirs], unresolved }
}

// --- the repo and its graph -----------------------------------------------------------------------

export type RepoSnapshot = {
    /** Absolute repo root. */
    root: string
    /** Every repo path (tracked + untracked, not ignored). */
    paths: Set<string>
    /** Text of each code file. */
    text: Map<string, string>
    /** Workspace package name → entry file (`@bismuth/memory` → `memory/src/index.ts`). */
    packages: Map<string, string>
}

export type Graph = {
    /** Each code file with comments and types stripped. */
    code: Map<string, string>
    /** file → files it loads or names. */
    deps: Map<string, Set<string>>
    /** file → files that load or name it. */
    rdeps: Map<string, Set<string>>
    /** file → directories it reads through an fs call ('' is the whole repo). */
    dirDeps: Map<string, string[]>
    /** Files with an fs call whose repo-relative path does not fold. */
    unresolved: Set<string>
    tests: string[]
    /** Test-bearing top-level dirs: `core`, `app`, … */
    workspaces: string[]
}

function resolveFrom(base: string, paths: Set<string>): string | undefined {
    const clean = normalize(base.split('?')[0]).replace(/^\.\//, '')
    if (clean.startsWith('..')) return undefined
    for (const s of RESOLVE_SUFFIXES) if (paths.has(clean + s)) return clean + s
    // TS ESM style: `./x.js` names `./x.ts`
    const js = clean.match(/^(.*)\.(js|jsx|mjs)$/)
    if (js)
        for (const s of ['.ts', '.tsx'])
            if (paths.has(js[1] + s)) return js[1] + s
    return undefined
}

/** Resolve a specifier written in `from`, with Bun's resolver first. An unresolvable relative
 *  specifier still gets an edge to the path it names (`.ts` when extensionless), so deleting a
 *  file selects its importers. */
export function resolveSpecifier(
    spec: string,
    from: string,
    snap: RepoSnapshot,
): string | undefined {
    if (!spec.includes('?')) {
        try {
            const abs = Bun.resolveSync(spec, join(snap.root, dirname(from)))
            const rel = abs.startsWith(snap.root + '/')
                ? abs.slice(snap.root.length + 1)
                : ''
            if (rel && !rel.includes('node_modules/') && snap.paths.has(rel))
                return rel
            if (abs !== spec && !rel) return undefined
        } catch {
            /* unresolvable: deleted, or a query import, handled below */
        }
    }
    if (spec.startsWith('.')) {
        const base = join(dirname(from), spec)
        const hit = resolveFrom(base, snap.paths)
        if (hit) return hit
        const clean = normalize(base.split('?')[0])
        if (clean.startsWith('..')) return undefined
        return /\.[a-z]{1,5}$/.test(clean) ? clean : clean + '.ts'
    }
    const pkg = [...snap.packages.keys()].find(
        n => spec === n || spec.startsWith(n + '/'),
    )
    if (pkg) {
        if (spec === pkg) return snap.packages.get(pkg)
        return resolveFrom(
            join(
                dirname(dirname(snap.packages.get(pkg)!)),
                spec.slice(pkg.length + 1),
            ),
            snap.paths,
        )
    }
    return undefined
}

/** Names a file exports that fold to a repo path (`export const REPO_ROOT = …`). */
function exportedNames(code: string, file: string): Map<string, string> {
    const exported = new Set(
        [
            ...code.matchAll(
                /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
            ),
        ].map(m => m[1]),
    )
    if (!exported.size) return new Map()
    return new Map(
        [...foldedNames(code, file)].filter(([n]) => exported.has(n)),
    )
}

export function buildGraph(snap: RepoSnapshot): Graph {
    const deps = new Map<string, Set<string>>()
    const rdeps = new Map<string, Set<string>>()
    const dirDeps = new Map<string, string[]>()
    const unresolved = new Set<string>()
    const workspaces = [
        ...new Set(
            [...snap.paths]
                .filter(p => isTestFile(p) && p.includes('/'))
                .map(p => p.split('/')[0]),
        ),
    ].sort()
    const dirs = new Set<string>()
    for (const p of snap.paths)
        for (let d = dirname(p); d !== '.'; d = dirname(d)) dirs.add(d)
    const edge = (a: string, b: string) => {
        if (a === b) return
        if (!deps.has(a)) deps.set(a, new Set())
        deps.get(a)!.add(b)
        if (!rdeps.has(b)) rdeps.set(b, new Set())
        rdeps.get(b)!.add(a)
    }
    const code = new Map<string, string>()
    for (const [file, text] of snap.text) {
        const stripped = stripComments(text, file)
        code.set(file, stripped)
        for (const spec of parseSpecifiers(text, file)) {
            const to = resolveSpecifier(spec, file, snap)
            if (to) edge(file, to)
        }
        for (const lit of parsePathLiterals(stripped)) {
            const ws = file.split('/')[0]
            const hit =
                (lit.startsWith('.') &&
                    resolveFrom(join(dirname(file), lit), snap.paths)) ||
                (!lit.startsWith('.') && snap.paths.has(lit) && lit) ||
                (snap.paths.has(join(ws, lit)) && join(ws, lit))
            if (hit) edge(file, hit)
        }
    }
    // Second pass: computed paths, with the repo-path names each file's imports export.
    const exportsOf = new Map<string, Map<string, string>>()
    const exportsFor = (f: string) => {
        if (!exportsOf.has(f))
            exportsOf.set(f, exportedNames(code.get(f) ?? '', f))
        return exportsOf.get(f)!
    }
    for (const [file, stripped] of code) {
        if (!LOCATION.test(stripped)) {
            const imported = [...(deps.get(file) ?? [])].some(
                d => exportsFor(d).size > 0,
            )
            if (!imported) continue
        }
        const inherited = new Map<string, string>()
        for (const d of deps.get(file) ?? [])
            for (const [n, p] of exportsFor(d)) inherited.set(n, p)
        const reads = computedReads(stripped, file, inherited, snap.paths, dirs)
        for (const f of reads.files) edge(file, f)
        if (reads.dirs.length) dirDeps.set(file, reads.dirs)
        if (reads.unresolved) unresolved.add(file)
    }
    const tests = [...snap.paths].filter(isTestFile).sort()
    return { code, deps, rdeps, dirDeps, unresolved, tests, workspaces }
}

/** Every file reachable from `start` along `edges`, `start` included. */
export function closure(
    start: Iterable<string>,
    edges: Map<string, Set<string>>,
): Set<string> {
    const seen = new Set<string>(start)
    const queue = [...seen]
    while (queue.length) {
        const f = queue.pop()!
        for (const n of edges.get(f) ?? [])
            if (!seen.has(n)) {
                seen.add(n)
                queue.push(n)
            }
    }
    return seen
}

/** Tests whose import closure reads a repo location through a path that does not fold. They run
 *  on every selection. */
export function alwaysTests(graph: Graph): Set<string> {
    const readers = closure(graph.unresolved, graph.rdeps)
    return new Set(graph.tests.filter(t => readers.has(t)))
}

/** Files that read `f` through a directory: `readdirSync(SRC)` reads every file under SRC. */
function dirReaders(f: string, graph: Graph): string[] {
    const out: string[] = []
    for (const [file, ds] of graph.dirDeps)
        if (ds.some(d => d === '' || f === d || f.startsWith(d + '/')))
            out.push(file)
    return out
}

export type Selection =
    | { all: true; reason: string }
    | { all: false; files: string[]; reasons: string[] }

/**
 * The test files `changed` can affect. `changed` holds repo paths that were added, modified or
 * deleted. Pure: everything it needs is in `graph` and `always`.
 */
export function selectTests(
    changed: string[],
    graph: Graph,
    always: Set<string>,
): Selection {
    const shared = changed.find(f =>
        SHARED_PREFIXES.some(p => f === p || f.startsWith(p)),
    )
    if (shared)
        return { all: true, reason: `${shared} is shared by every workspace` }
    if (changed.length === 0) return { all: false, files: [], reasons: [] }
    const picked = new Set<string>()
    const reasons: string[] = []
    for (const f of changed) {
        const readers = dirReaders(f, graph)
        closure([f, ...readers], graph.rdeps).forEach(t => {
            if (isTestFile(t)) picked.add(t)
        })
        if (graph.rdeps.has(f) || readers.length || isTestFile(f)) continue
        const top = f.includes('/') ? f.split('/')[0] : f
        if (graph.workspaces.includes(top)) {
            graph.tests
                .filter(t => t.startsWith(top + '/'))
                .forEach(t => picked.add(t))
            reasons.push(`${f} is loaded or read by no file → all of ${top}/`)
        }
    }
    always.forEach(t => picked.add(t))
    return { all: false, files: [...picked].sort(), reasons }
}

/** Read the repo from disk: every non-ignored path, the text of every code file, workspace packages. */
export function snapshotRepo(root = process.cwd()): RepoSnapshot {
    root = root.replace(/\/$/, '')
    const r = spawnSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    const paths = new Set(
        r.stdout
            .split('\0')
            .filter(Boolean)
            .filter(p => existsSync(join(root, p))),
    )
    const text = new Map<string, string>()
    for (const p of paths)
        if (CODE_EXT.test(p) && !p.endsWith('.d.ts')) {
            try {
                if (statSync(join(root, p)).size < 2_000_000)
                    text.set(p, readFileSync(join(root, p), 'utf8'))
            } catch {
                /* vanished between ls-files and read */
            }
        }
    const packages = new Map<string, string>()
    for (const p of paths) {
        if (!/^[^/]+\/package\.json$/.test(p)) continue
        try {
            const pkg = JSON.parse(readFileSync(join(root, p), 'utf8'))
            const entry =
                (typeof pkg.exports === 'object' && pkg.exports?.['.']) ||
                (typeof pkg.exports === 'string' && pkg.exports) ||
                pkg.main ||
                './src/index.ts'
            const file = resolveFrom(join(dirname(p), entry), paths)
            if (pkg.name && file) packages.set(pkg.name, file)
        } catch {
            /* not a workspace package */
        }
    }
    return { root, paths, text, packages }
}

if (import.meta.main) {
    const graph = buildGraph(snapshotRepo())
    const always = alwaysTests(graph)
    const sel = selectTests(process.argv.slice(2), graph, always)
    if (sel.all) console.log(`all tests: ${sel.reason}`)
    else {
        for (const r of sel.reasons) console.log(`# ${r}`)
        console.log(
            `# ${sel.files.length} test file(s), ${always.size} of them always-run`,
        )
        for (const f of sel.files) if (!always.has(f)) console.log(f)
    }
}
