// bench/moduleClassCheck.ts — emitted-CSS ↔ emitted-JS cross-check for CSS Modules.
//
// WHY THIS EXISTS. When a rule moves out of the global App.css into a `<Component>.module.css`, the
// class name is HASHED at build time (`.ft-row` -> `._ft-row_163am_18`) and is reachable only through
// the imported `styles` object. A call site the migration forgot keeps its old string literal:
//
//     <div class="ft-row">          // still compiles, still renders, matches NOTHING
//     <div class={styles["ft-row"]} // correct
//
// Nothing else in this toolchain sees that. `tsc` reads no CSS. Bun resolves `solid-js/web` to its
// server build, so `render()` throws "Client-only API called on the server side" and this repo has
// zero .test.tsx files. bench/cssBaseline.ts DOES see it, but only for a class that some story
// actually renders in its resting state — it is blind to a `:hover` branch, a Tauri-only window
// control, a rarely-hit state, and to any component with no story at all. This check needs no story:
// it reads the production bundle and compares names.
//
// WHAT IT CANNOT CATCH — read this before trusting a green run. It compares NAMES, not appearance.
//   * A rule whose declarations changed while migrating (a dropped `padding`, a `var(--fg)` swapped
//     for a literal) keeps its name and passes here, forever. Only bench/cssBaseline.ts sees that.
//     This tool does not replace the computed-style baseline; it covers what the baseline is blind to.
//   * Specificity and cascade order. `.ft-row .ft-icon` becoming `.ft-icon .ft-row` passes.
//   * A class reached through a dynamic key (`styles[kind]`). That is reported as UNCHECKABLE per
//     module rather than guessed at — see DYNAMIC below.
//   * A literal that reaches the DOM by a route other than a compiled Solid template attribute
//     (setAttribute in a helper, a class assembled by string concatenation at runtime). Check B
//     reads the template attributes the Solid compiler emits, which is the dominant path, not all of
//     them.
//   * Anything at all in a module whose `styles` object is indexed by a runtime key. That module is
//     reported UNCHECKED, not passed — bases/Charts.module.css is in that state today.
//
// THE THREE CHECKS.
//   A. REACHABILITY. Every hashed class in the emitted CSS must be reached from the emitted JS —
//      either as a key read off its module's `styles` map (`Ke["ft-prefix"]`, `Ke.selected`), or
//      composed into another class (`composes: block` emits "_cell_1tsjj_38 _block_1tsjj_12").
//      This is deliberately NOT the naive "the hashed string appears somewhere in the JS". Vite
//      emits the module's export map into the chunk — `{"ft-prefix":"_ft-prefix_163am_35", …}` —
//      and the naive form is only saved from vacuity by an OPTIMIZATION: measured on this repo's
//      real build, Rollup+esbuild prune the map entries nothing reads, which is why
//      `_ft-chevron_163am_27` is in the emitted CSS and in no JS chunk at all. That is a minifier
//      behaviour, not a contract — `build.minify:false`, or a bundler version that stops pruning
//      object literals, would silently turn the naive check green forever. Finding the map and then
//      finding reads OF the map does not depend on it.
//   B. NO UNHASHED LITERAL. A module-owned class name must not appear as a literal class attribute
//      in a compiled template (`class=ft-prefix`) — that is the exact bug above. B is not redundant
//      with A: `.ft-prefix` has TWO call sites in FileTree.tsx, and sabotaging ONE of them leaves
//      the other reading `styles["ft-prefix"]`, so A stays green and only B fires. A partially
//      migrated class is the likelier real mistake, and A alone cannot see it. B only runs for
//      names UNIQUE to modules: a name a global stylesheet also declares (`.active`, `.row`,
//      `.hidden`, …) is genuinely indistinguishable in the bundle, so those are listed as skipped
//      rather than guessed at.
//   C. NAME COLLISIONS (warning, not a failure). Every name declared by both a module and a global
//      stylesheet. This is where "a rule was COPIED into the module instead of MOVED" shows up.
//      It is a warning because the same signal is produced by an entirely legitimate arrangement —
//      a module's local `.active` and some unrelated component's global `.active` — and this repo
//      has twelve of those today. Judge each one; do not assume red.
//      There is deliberately NO "unhashed selector survived in the emitted CSS" check. It sounds
//      like the CSS-side twin of B and it cannot work: a CSS Module ALWAYS hashes, so a bare
//      `.name` in the bundle is by construction some OTHER stylesheet's rule — in practice a
//      vendor's. Written as a failure it reported katex's `.base` and `.accent` against
//      BaseView/Charts on a clean tree. The checkable part of that idea is C.
//
//   cd app && bun run build            # or let this tool run it
//   bun bench/moduleClassCheck.ts      # exit 0 = clean, exit 1 = findings
//   bun bench/moduleClassCheck.ts --skip-build     # reuse an existing app/dist
import { spawnSync } from 'node:child_process'
import {
    readFileSync,
    readdirSync,
    writeFileSync,
    rmSync,
    existsSync,
} from 'node:fs'
import { join, relative } from 'node:path'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const has = (n: string) => process.argv.includes(`--${n}`)
const ROOT = join(import.meta.dir, '..')
const APP = join(ROOT, 'app')
const SRC = join(APP, 'src')
const DIST = arg('dist', join(APP, 'dist'))
const ASSETS = join(DIST, 'assets')
/** Full findings dump. Generated, gitignored, overwritten every failing run and DELETED on a clean
 *  one — the same contract as bench/css-baseline.drift.txt, for the same reason: a stale dump left
 *  beside a passing run gets grepped and believed. */
const DUMP = join(import.meta.dir, 'module-class-check.txt')

/** Classes that are legitimately unreachable from JS. START EMPTY; every entry carries its argument.
 *  A `composes:` target does NOT belong here — composition is resolved automatically (see COMPOSED). */
const ALLOW = new Set<string>([
    // FileTree.module.css says so in its own header: "`.ft-chevron` has zero references in any .tsx or
    // .ts. It is moved verbatim rather than deleted: dead-rule removal is Task 11 of the
    // modularization, and this task changes nothing but location." Deliberately-retained dead rule, so
    // it is an orphan by construction. Delete this line when Task 11 deletes the rule.
    'FileTree.module.css:ft-chevron',
])

const log = (s = '') => process.stderr.write(s + '\n')
const out: string[] = []

// ---------------------------------------------------------------------------------------------
// 1. Build (unless reusing dist)
// ---------------------------------------------------------------------------------------------
if (!has('skip-build')) {
    log('building app (vite build)…')
    const r = spawnSync('bun', ['run', 'build'], {
        cwd: APP,
        stdio: ['ignore', 'ignore', 'inherit'],
    })
    if (r.status !== 0) {
        log('BUILD FAILED')
        process.exit(2)
    }
}
if (!existsSync(ASSETS)) {
    log(`no build output at ${ASSETS} — drop --skip-build`)
    process.exit(2)
}

// ---------------------------------------------------------------------------------------------
// 2. Source modules: which class names does each *.module.css define?
// ---------------------------------------------------------------------------------------------
const allFiles = (dir: string, acc: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        const p = join(dir, e.name)
        if (e.isDirectory()) allFiles(p, acc)
        else acc.push(p)
    }
    return acc
}
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
/** Names inside `:global(...)` are NOT hashed, so they are not this tool's business — and counting
 *  them would attribute a global class to a module. Paren-matched, because the codebase writes
 *  `:global(li:has(> .bismuth-task-box))` and a lazy `\([^)]*\)` cuts that in half. */
function stripGlobal(css: string): string {
    let o = '',
        i = 0
    for (;;) {
        const at = css.indexOf(':global(', i)
        if (at < 0) return o + css.slice(i)
        o += css.slice(i, at)
        let depth = 0,
            j = at + ':global'.length
        for (; j < css.length; j++) {
            if (css[j] === '(') depth++
            else if (css[j] === ')' && --depth === 0) break
        }
        i = j + 1
    }
}
/** Every LOCAL name a module exports — class selectors AND `@keyframes` names.
 *
 *  Keyframes matter because CSS Modules hashes and exports them exactly like classes, and attribution
 *  (step 5) demands that every emitted local be found in some module's declared set. A module whose
 *  keyframe name is not also a class therefore matched NOTHING and was reported as "emitted nothing
 *  into the bundle" — a hard finding, on a module that had built and shipped correctly. PaneTree hit
 *  this with `@keyframes pane-in`; Flashcards did not, only because its `card-appear` keyframe happens
 *  to share a name with a class. A false finding on a healthy module is expensive: it is
 *  indistinguishable from the real thing it exists to catch, which is a module nothing imports. */
const classesIn = (css: string) => {
    const clean = stripGlobal(stripComments(css))
    const names = new Set(
        (clean.match(/\.[A-Za-z_][A-Za-z0-9_-]*/g) ?? []).map(s => s.slice(1)),
    )
    for (const m of clean.matchAll(
        /@(?:-webkit-)?keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g,
    ))
        names.add(m[1]!)
    return names
}

const moduleFiles = allFiles(SRC).filter(f => f.endsWith('.module.css'))
if (moduleFiles.length === 0) {
    log(
        'found no *.module.css under app/src — nothing to check (is this the right tree?)',
    )
    process.exit(2)
}
const moduleClasses = new Map<string, Set<string>>() // "FileTree.module.css" -> {ft-row, …}
for (const f of moduleFiles)
    moduleClasses.set(relative(SRC, f), classesIn(readFileSync(f, 'utf8')))
log(
    `${moduleFiles.length} CSS modules, ${[...moduleClasses.values()].reduce((n, s) => n + s.size, 0)} declared class names`,
)

/** Every class name any GLOBAL (non-module) stylesheet in app/src also defines. B1/B2 cannot tell a
 *  module's `.active` from App.css's `.active` once both are in one bundle, so they skip these. */
const globalClasses = new Set<string>()
for (const f of allFiles(SRC).filter(
    f => f.endsWith('.css') && !f.endsWith('.module.css'),
))
    for (const c of classesIn(readFileSync(f, 'utf8'))) globalClasses.add(c)

// ---------------------------------------------------------------------------------------------
// 3. Emitted artifacts
// ---------------------------------------------------------------------------------------------
const assets = readdirSync(ASSETS)
const cssFiles = assets.filter(f => f.endsWith('.css'))
const jsFiles = assets.filter(f => f.endsWith('.js'))
const css = new Map(
    cssFiles.map(f => [f, readFileSync(join(ASSETS, f), 'utf8')]),
)
const js = new Map(jsFiles.map(f => [f, readFileSync(join(ASSETS, f), 'utf8')]))
log(
    `${cssFiles.length} css + ${jsFiles.length} js chunks in ${relative(ROOT, ASSETS)}`,
)

/** The shape Vite emits for a CSS-Modules local: `_<local>_<hash5>_<n>`. DERIVED FROM THE REAL BUILD,
 *  not guessed — every `._…` token in this repo's emitted CSS matches it, across all five modules.
 *  The local name may itself contain `_` and `-`, so the tail is anchored and the head lazy.
 *  The hash is LOWERCASE base36 (163am 1meru 1ojhu 1tsjj 1vop5): allowing uppercase made
 *  `_LIST_QUICK_1` inside univer's bundled JS parse as a sixth CSS module. */
const HASHED = /_([A-Za-z0-9_-]+?)_([a-z0-9]{5})_(\d+)(?![A-Za-z0-9_-])/
const HASHED_IN_CSS = new RegExp('\\.(' + HASHED.source + ')', 'g')

/** hashId -> local names seen. Both sides feed this: a class with a rule but no export (a `composes`
 *  target) shows up only in CSS; a class exported but with no rule of its own only in JS. */
const localsByHash = new Map<string, Set<string>>()
const addLocal = (hash: string, local: string) => {
    if (!localsByHash.has(hash)) localsByHash.set(hash, new Set())
    localsByHash.get(hash)!.add(local)
}
/** hashId -> local -> the css files that carry a rule for it (for the report). */
const cssHomeOf = new Map<string, string>()
for (const [file, text] of css) {
    for (const m of text.matchAll(HASHED_IN_CSS)) {
        const [, , local, hash] = m
        addLocal(hash, local)
        if (!cssHomeOf.has(`${hash}:${local}`))
            cssHomeOf.set(`${hash}:${local}`, file)
    }
}
if (localsByHash.size === 0) {
    out.push(
        'FATAL: no hashed CSS-Modules class found in any emitted stylesheet.',
    )
    out.push(
        "Either the build output is stale/empty or Vite's scoped-name format changed — either way this check is not looking at anything.",
    )
    console.log(out.join('\n'))
    process.exit(1)
}

// ---------------------------------------------------------------------------------------------
// 4. Find each module's exported `styles` map in the JS, and every read OF it
// ---------------------------------------------------------------------------------------------
/** `const Vy="_hidden_163am_39"` and `const qd="_cell_1tsjj_38 _block_1tsjj_12"` — the hoisted
 *  single-class consts a map then references by identifier.
 *
 *  IDENTIFIER BOUNDARY IS A LOOKBEHIND, NOT `\b` — found 2026-08 when ChatTurnParts.module.css (a
 *  single-consumer module, same shape as a dozen others that resolved fine) reported "NO EXPORT MAP
 *  found in any JS chunk" despite its map genuinely being right there: esbuild had minified its
 *  identifier down to the bare, single-character `$`. JS regex `\w` does NOT include `$`, so `\b`
 *  before a `$`-led identifier only fires when the PRECEDING character is a word character —
 *  `,$={…}` (comma then `$`) is a non-word-to-non-word transition, which is not a boundary at all,
 *  so `\b` silently declined to match and the whole map went undetected. The "reads of this map"
 *  regex further down already dodges this with `(?<![A-Za-z0-9_$])`; ALIAS/OBJECT just hadn't been
 *  brought in line with it. Confirmed both ways: the old `\b` form matches 0 times against
 *  `,$={"k":"_x_dul2x_9"}`, the lookbehind form matches 1. */
const ALIAS =
    /(?<![A-Za-z0-9_$])([A-Za-z_$][\w$]*)\s*=\s*"((?:_[A-Za-z0-9_-]+)(?:\s+_[A-Za-z0-9_-]+)*)"/g
/** A brace-delimited object literal with no nested braces — the shape every emitted map has. */
const OBJECT = /(?<![A-Za-z0-9_$])([A-Za-z_$][\w$]*)\s*=\s*\{([^{}]*)\}/g
const ENTRY =
    /(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*(?:"([^"]*)"|([A-Za-z_$][\w$]*))/g

/** hashId -> keys read off the map somewhere in the JS. */
const readKeys = new Map<string, Set<string>>()
/** hashId -> local names pulled in by `composes:`. */
const composed = new Map<string, Set<string>>()
/** hashId -> chunks where the map is indexed by a non-literal key, making it uncheckable. */
const dynamic = new Map<string, Set<string>>()
/** hashId -> map identifiers found, for the report. */
const mapsFound = new Map<string, Set<string>>()
const bump = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(v)
}
/** The emitted CSS is the authority on which hash ids are real. Snapshot it before the JS scan so a
 *  string in a vendor bundle that merely LOOKS like a scoped name cannot invent a module. */
const CSS_HASHES = new Set(localsByHash.keys())

for (const [file, text] of js) {
    const aliases = new Map<string, string>()
    for (const m of text.matchAll(ALIAS))
        if (HASHED.test(m[2])) aliases.set(m[1], m[2])

    for (const m of text.matchAll(OBJECT)) {
        const ident = m[1],
            body = m[2]
        const entries: Array<[string, string]> = []
        for (const e of body.matchAll(ENTRY)) {
            const key = e[1] ?? e[2] ?? e[3]
            const value = e[4] !== undefined ? e[4] : aliases.get(e[5]!)
            if (key && value && HASHED.test(value)) entries.push([key, value])
        }
        if (entries.length === 0) continue

        // The map's own hash id: whichever hash its first entry's PRIMARY class carries. (A composed
        // value's trailing tokens can belong to a different module, so only the first token counts.)
        const primary = entries[0][1].split(/\s+/)[0].match(HASHED)
        if (!primary) continue
        const hash = primary[2]
        if (!CSS_HASHES.has(hash)) continue
        bump(mapsFound, hash, `${file}:${ident}`)

        for (const [, value] of entries) {
            const toks = value.trim().split(/\s+/)
            const head = toks[0].match(HASHED)
            if (head) addLocal(head[2], head[1])
            // Everything after the first token arrived via `composes:` and rides along whenever the
            // composing class is used. Mark it reached in ITS OWN module — `composes` can cross files.
            for (const t of toks.slice(1)) {
                const c = t.match(HASHED)
                if (c) {
                    addLocal(c[2], c[1])
                    bump(composed, c[2], c[1])
                }
            }
        }

        // Reads of this map. Word-boundary-anchored so a longer identifier ending in `ident` is not a hit.
        const esc = ident.replace(/\$/g, '\\$')
        for (const r of text.matchAll(
            new RegExp(`(?<![A-Za-z0-9_$])${esc}\\.([A-Za-z_$][\\w$]*)`, 'g'),
        ))
            bump(readKeys, hash, r[1])
        for (const r of text.matchAll(
            new RegExp(
                `(?<![A-Za-z0-9_$])${esc}\\[\\s*("([^"]*)"|'([^']*)')\\s*\\]`,
                'g',
            ),
        ))
            bump(readKeys, hash, r[2] ?? r[3]!)
        // An index that is not a string literal (`styles[kind]`) resolves at runtime; this tool cannot
        // know which classes it covers, so say so instead of reporting the module's classes as orphans.
        if (new RegExp(`(?<![A-Za-z0-9_$])${esc}\\[\\s*(?!["'])`).test(text))
            bump(dynamic, hash, file)
    }
}

// ---------------------------------------------------------------------------------------------
// 5. Attribute each hash id to a source module (by class-name containment)
// ---------------------------------------------------------------------------------------------
const moduleOf = new Map<string, string>() // hashId -> "FileTree.module.css"
const unattributed: string[] = []
for (const [hash, locals] of localsByHash) {
    const fits = [...moduleClasses].filter(([, defined]) =>
        [...locals].every(l => defined.has(l)),
    )
    if (fits.length === 1) moduleOf.set(hash, fits[0][0])
    else if (fits.length > 1) {
        // Tie-break on the smallest declared set; report either way so an ambiguous attribution is
        // never silently presented as fact.
        fits.sort((a, b) => a[1].size - b[1].size)
        moduleOf.set(hash, fits[0][0])
        unattributed.push(
            `AMBIGUOUS: hash ${hash} fits ${fits.length} modules (${fits.map(f => f[0]).join(', ')}); reporting as ${fits[0][0]}`,
        )
    } else
        unattributed.push(
            `UNATTRIBUTED: hash ${hash} (locals: ${[...locals].sort().join(', ')}) matches no *.module.css class set`,
        )
}
/** hashId of a module, inverted — used to notice a module that emitted nothing at all. */
const hashOf = new Map([...moduleOf].map(([h, m]) => [m, h]))
const name = (hash: string) =>
    moduleOf.get(hash) ?? `<unknown module, hash ${hash}>`

// ---------------------------------------------------------------------------------------------
// 6. Check A — every hashed class is reached from the JS
// ---------------------------------------------------------------------------------------------
const findings: string[] = []
const skippedDynamic: string[] = []
for (const [hash, locals] of [...localsByHash].sort()) {
    const mod = name(hash)
    if (!mapsFound.has(hash)) {
        findings.push(
            `${mod}: NO EXPORT MAP found in any JS chunk — every class in this module is unreachable (module imported by nothing, or the emit shape changed)`,
        )
        continue
    }
    if (dynamic.has(hash)) {
        skippedDynamic.push(
            `${mod}: indexed by a runtime key in ${[...dynamic.get(hash)!].join(', ')} — reachability UNCHECKED for this module`,
        )
        continue
    }
    const read = readKeys.get(hash) ?? new Set()
    const comp = composed.get(hash) ?? new Set()
    for (const local of [...locals].sort()) {
        if (read.has(local) || comp.has(local)) continue
        if (ALLOW.has(`${mod}:${local}`)) continue
        const home =
            cssHomeOf.get(`${hash}:${local}`) ?? '(no rule; exported only)'
        findings.push(
            `${home}: _${local}_${hash}_… (from ${mod}) — hashed class is in the CSS but nothing reads styles["${local}"]`,
        )
    }
}
for (const [mod] of moduleClasses)
    if (!hashOf.has(mod))
        findings.push(
            `${mod}: emitted NOTHING into the bundle — no hashed class from this module is present (dead module, or it failed to build)`,
        )

// ---------------------------------------------------------------------------------------------
// 7. Check B — no unhashed literal survivor; check C — name collisions with a global stylesheet
// ---------------------------------------------------------------------------------------------
/** Literal class attributes the Solid compiler wrote into a template: `class=foo` (single, unquoted
 *  — Solid's own output shape) and `class="a b"` (multiple). Both appear in this repo's real bundle.
 *  Every JS chunk is scanned, vendor ones included; that is safe only because the names compared
 *  against it are module-owned AND not declared by any global stylesheet. */
const CLASS_ATTR = /class=(?:"([^"\\]{0,200}?)"|([A-Za-z0-9_:.-]+))/g
const literalClasses = new Map<string, Set<string>>() // className -> js chunks
for (const [file, text] of js) {
    for (const m of text.matchAll(CLASS_ATTR)) {
        for (const c of (m[1] ?? m[2] ?? '').split(/\s+/)) {
            if (!c) continue
            if (!literalClasses.has(c)) literalClasses.set(c, new Set())
            literalClasses.get(c)!.add(file)
        }
    }
}
const collisions: string[] = []
for (const [hash, locals] of [...localsByHash].sort()) {
    const mod = name(hash)
    for (const local of [...locals].sort()) {
        if (globalClasses.has(local)) {
            collisions.push(
                `${mod}: "${local}" is declared by a global stylesheet too — check B skipped (indistinguishable in the bundle); if the global rule is a LEFTOVER of this migration, delete it`,
            )
            continue
        }
        const inJs = literalClasses.get(local)
        if (inJs)
            findings.push(
                `${[...inJs].join(', ')}: class=${local} (from ${mod}) — UNHASHED literal reaches the DOM and matches no rule`,
            )
    }
}

// ---------------------------------------------------------------------------------------------
// 8. Report
// ---------------------------------------------------------------------------------------------
log(
    `${localsByHash.size} modules present in the bundle: ${[...localsByHash.keys()].map(h => `${name(h)}=${h}`).join(', ')}`,
)
const warnings = [...unattributed, ...skippedDynamic, ...collisions]
out.push(
    `WARNINGS (${warnings.length}) — reviewed by a human, never a failure on their own:`,
)
if (has('verbose')) for (const s of warnings) out.push(`  ${s}`)
else {
    for (const s of [...unattributed, ...skippedDynamic]) out.push(`  ${s}`)
    if (collisions.length)
        out.push(
            `  ${collisions.length} name(s) shared with a global stylesheet — check B skipped for them (--verbose to list)`,
        )
}
out.push('')
out.push(
    `FINDINGS (${findings.length}) — each is a class that cannot be reaching the DOM as intended:`,
)
for (const f of findings) out.push(`  ${f}`)
console.log(out.join('\n'))
// Terminal output gets truncated and the interesting line is never the first one, so a failing run
// always leaves the complete list somewhere greppable — and a clean run removes the previous one.
if (findings.length) {
    writeFileSync(DUMP, [...warnings, '', ...findings].join('\n') + '\n')
    console.log(`full findings -> ${DUMP}`)
} else {
    try {
        rmSync(DUMP, { force: true })
    } catch {}
}
process.exit(findings.length === 0 ? 0 : 1)
