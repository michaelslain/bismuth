// bench/templateDiff.ts — did this refactor change the emitted MARKUP?
//
// WHY THIS EXISTS. Every task of the App.tsx/App.css componentization moves JSX from one file to
// another and then rewrites its class attributes from global string literals to CSS-Module lookups.
// Both halves claim "the DOM is unchanged", and neither claim is checkable by reading the diff: the
// markup is reindented, the handlers are rewritten from inline arrows to props, and `class="win-btn"`
// becomes `class={styles["win-btn"]}`. A human comparing those two blocks is comparing prose.
//
// The Solid compiler settles it. `babel-preset-solid` emits the STATIC part of every element tree as
// one `_$template("<html…>")` string — tag names, nesting, attribute names and their literal values,
// and every text node all live inside it, while the dynamic parts (event handlers, reactive
// attributes) come out as separate statements. So compiling both sides through THE REPO'S OWN preset
// and comparing those strings is a byte-level comparison of exactly the thing that must not change,
// and it is immune to indentation, to renamed handlers, and to how the props are threaded.
//
// TWO MODES, because the two halves of a migration make different claims:
//   * default — the templates must be EQUAL. This is the extraction half: markup moved between files
//     and nothing about it may differ.
//   * --modulo-class — equal after deleting every `class=…` attribute from both sides. This is the
//     CSS half: a `class` that becomes a dynamic expression stops being a static attribute, so Solid
//     legitimately drops it from the template and writes className imperatively instead. Everything
//     else — tags, nesting, `type`/`title`/`aria-*`, text nodes — must still match.
//
// WHAT THIS DOES NOT PROVE. Read this before quoting a green run at anyone.
//   * NOTHING ABOUT CSS, styling or appearance. It never opens a stylesheet. A migration that moves
//     every rule into a module and drops half their declarations passes here, and so does one that
//     hashes a class into a name no rule defines. bench/cssBaseline.ts and bench/moduleClassCheck.ts
//     are what cover those; this tool is blind to both and does not replace either.
//   * NOTHING ABOUT THE DYNAMIC HALF. Whatever the compiler emits outside the template string —
//     event handlers, `classList`, reactive attributes, `<Show>`/`<For>` boundaries and the
//     className writes that --modulo-class exists to tolerate — is not compared at all. Under
//     --modulo-class in particular, a class attribute that was deleted outright and one that was
//     correctly converted to a module lookup are INDISTINGUISHABLE here. That is the whole reason
//     --modulo-class must be paired with an instrument that reads the DOM (bench/probeStory.ts) or
//     the bundle (bench/moduleClassCheck.ts).
//   * NOTHING ABOUT RUNTIME. It compiles source; it never mounts a component. A component that
//     throws on mount emits a perfectly matching template.
//   * NOTHING ABOUT WHAT THE COMPONENT IS GIVEN. Props, callbacks and defaults are invisible to it,
//     so a prop wired to the wrong handler passes.
//   * It compares the templates the SOLID compiler produces, not the browser's DOM. Attribute ORDER
//     inside a tag is the compiler's, and a reordering that a browser would treat as identical is
//     reported as a difference here. That is deliberate — false alarms are cheap, and the alternative
//     is parsing HTML and re-introducing the ambiguity this tool exists to remove.
//   * --modulo-class strips `class` attributes with a regex over the emitted template. It is exact
//     for the quoted and bare forms Solid emits; a `class` substring inside a TEXT NODE would also be
//     stripped. Both sides get the identical treatment, so this cannot produce a false PASS on
//     anything except a difference that is itself only in such a substring.
//
//   bun bench/templateDiff.ts app/src/App.tsx app/src/shell/WindowControls.tsx --lines-a 2129-2133
//   bun bench/templateDiff.ts HEAD~1:app/src/shell/WindowControls.tsx app/src/shell/WindowControls.tsx --modulo-class
import { existsSync, readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
// babel-preset-solid and @babel/core are TRANSITIVE deps of vite-plugin-solid: always installed,
// never resolvable from bench/ by name (bun keeps them in .bun/ and links only direct deps). Resolve
// the plugin from the app workspace, then resolve both out of the plugin's own dependency scope —
// so this tool compiles with the exact preset copy `bun run build` uses, which is what makes the
// comparison meaningful, and it survives a version bump without a hardcoded store path.
const VPS = Bun.resolveSync('vite-plugin-solid', `${ROOT}/app/`)
const PRESET = Bun.resolveSync('babel-preset-solid', VPS)
// Typed structurally rather than as `typeof import("@babel/core")`: the package is not resolvable
// from bench/ by name (that is why it is loaded by resolved path), so a nominal type reference to it
// would not resolve either. Only these two members are used.
type BabelResult = { code?: string | null } | null
type Babel = {
    transformSync: (code: string, opts: Record<string, unknown>) => BabelResult
}
const { transformSync } = (await import(
    Bun.resolveSync('@babel/core', VPS)
)) as Babel

// Only these flags take a value; every other --name is a boolean, and everything left over is a side.
const VALUE_FLAGS = new Set(['lines', 'lines-a', 'lines-b', 'index'])
const argv = process.argv.slice(2)
const opts = new Map<string, string>()
const sides: string[] = []
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
        sides.push(a)
        continue
    }
    const name = a.slice(2)
    opts.set(name, VALUE_FLAGS.has(name) ? (argv[++i] ?? '') : '1')
}
const MODULO_CLASS = opts.has('modulo-class')
const VERBOSE = opts.has('verbose')
const LINES = opts.get('lines') ?? ''
const LINES_A = opts.get('lines-a') ?? LINES,
    LINES_B = opts.get('lines-b') ?? LINES
const INDEX = opts.has('index') ? Number(opts.get('index')) : null

if (sides.length !== 2) {
    console.error(`usage: bun bench/templateDiff.ts <A> <B> [--modulo-class] [--lines N-M | --lines-a N-M --lines-b N-M] [--index N] [--verbose]

  <A>, <B>        a file path, or <git-ref>:<repo-relative-path> to read a pre-refactor source
                  straight out of git with no stashing (e.g. HEAD:app/src/App.tsx)
  --modulo-class  compare after deleting every class attribute from both sides (the CSS half)
  --lines N-M     narrow a side to an inclusive 1-based line range, wrapped as one expression;
                  use for a component still inside a big file. --lines-a/--lines-b to differ.
  --index N       compare only the Nth (0-based) emitted template on each side
  --verbose       print every template, not just the mismatching ones

exit 0 = the emitted templates match, 1 = they differ, 2 = bad usage or a compile error`)
    process.exit(2)
}

/** A side is either a working-tree path or `<git-ref>:<repo-relative-path>`. The git form is the
 *  point of this argument shape: the pre-refactor source of a file you are editing right now lives
 *  only in git, and stashing to read it is both slow and destructive. */
function readSide(spec: string): string {
    if (existsSync(spec)) return readFileSync(spec, 'utf8')
    const m = /^([^:]+):(.+)$/.exec(spec)
    if (m) {
        const r = Bun.spawnSync(['git', '-C', ROOT, 'show', `${m[1]}:${m[2]}`])
        if (r.exitCode !== 0) {
            console.error(
                `cannot read "${spec}" as a file or as a git ref:\n${r.stderr.toString()}`,
            )
            process.exit(2)
        }
        return r.stdout.toString()
    }
    console.error(`no such file, and not a <git-ref>:<path>: ${spec}`)
    process.exit(2)
}

/** A line range is wrapped as `const _x = ( … );` so a bare JSX element block — a component still
 *  embedded in a 2000-line file — parses as an expression. Without a range the whole module is
 *  compiled, which is the normal case for an extracted component file. */
function prepare(src: string, range: string, spec: string): string {
    if (!range) return src
    const m = /^(\d+)-(\d+)$/.exec(range)
    if (!m) {
        console.error(`--lines wants N-M, got "${range}"`)
        process.exit(2)
    }
    const lines = src.split('\n').slice(Number(m[1]) - 1, Number(m[2]))
    if (lines.length === 0) {
        console.error(`${spec}: line range ${range} is empty`)
        process.exit(2)
    }
    return `const _templateDiffSlice = (\n${lines.join('\n')}\n);\n`
}

/** The templates a side emits, in source order. `parserOpts.plugins` carries TypeScript so a .tsx
 *  module parses without a separate TS preset: babel-preset-solid only rewrites JSX nodes, and the
 *  generator prints the type annotations it does not care about straight back out. */
function templates(src: string, spec: string): string[] {
    let code: string
    try {
        code =
            transformSync(src, {
                filename: spec.replace(/^.*:/, ''),
                presets: [[PRESET, {}]],
                parserOpts: { plugins: ['typescript', 'jsx'] },
                configFile: false,
                babelrc: false,
                cloneInputAst: false,
            })?.code ?? ''
    } catch (e) {
        console.error(
            `${spec}: failed to compile — ${(e as Error).message.split('\n')[0]}`,
        )
        process.exit(2)
    }
    // The literal handed to _$template. Both quote styles, because the preset picks per content.
    return [
        ...code.matchAll(
            /_\$template\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
        ),
    ].map(m => m[1]!)
}

/** Delete every `class=…` attribute. Replaced by a single space only when an attribute name follows,
 *  because the preset emits no space after a quoted value (`class="a b"title=Close`) — a blind
 *  deletion there would weld two attributes into one and report a phantom difference. */
const stripClassAttrs = (t: string) =>
    t.replace(
        / class=(?:"[^"]*"|'[^']*'|[^\s>]*)/g,
        (m, off: number, s: string) =>
            /[A-Za-z]/.test(s[off + m.length] ?? '') ? ' ' : '',
    )

const [specA, specB] = sides as [string, string]
let a = templates(prepare(readSide(specA), LINES_A, specA), specA)
let b = templates(prepare(readSide(specB), LINES_B, specB), specB)

if (INDEX !== null) {
    if (!a[INDEX] || !b[INDEX]) {
        console.error(
            `--index ${INDEX} out of range (A has ${a.length}, B has ${b.length})`,
        )
        process.exit(2)
    }
    a = [a[INDEX]!]
    b = [b[INDEX]!]
}

if (a.length === 0 && b.length === 0) {
    // Two sides that emit nothing would otherwise compare "equal" and report a triumphant PASS having
    // measured nothing at all — the classic vacuous green.
    console.error(
        `both sides emitted ZERO templates — nothing was compared. Wrong --lines range, or neither side contains JSX.`,
    )
    process.exit(2)
}

const norm = (t: string) => (MODULO_CLASS ? stripClassAttrs(t) : t)
const label = MODULO_CLASS ? 'modulo class attributes' : 'byte-for-byte'
console.log(
    `A: ${specA}${LINES_A ? ` (lines ${LINES_A})` : ''} — ${a.length} template(s)`,
)
console.log(
    `B: ${specB}${LINES_B ? ` (lines ${LINES_B})` : ''} — ${b.length} template(s)`,
)
console.log(`comparing ${label}\n`)

const diffs: string[] = []
if (a.length !== b.length)
    diffs.push(`template COUNT differs: A has ${a.length}, B has ${b.length}`)
for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] === undefined ? null : norm(a[i]!)
    const y = b[i] === undefined ? null : norm(b[i]!)
    if (x === y) {
        if (VERBOSE) console.log(`[${i}] same: ${x}`)
        continue
    }
    if (x === null || y === null) {
        diffs.push(`[${i}] present on only one side:\n  ${x ?? y}`)
        continue
    }
    let k = 0
    while (k < x.length && k < y.length && x[k] === y[k]) k++
    // The caret's leading run is `"  A: ".length` + 1 for the template's own opening quote, so it lands
    // on the differing character of the line printed directly above it.
    diffs.push(
        `[${i}] differs at char ${k}\n  A: ${x}\n  B: ${y}\n` +
            `${' '.repeat(6 + k)}^ A has ${JSON.stringify(x.slice(k, k + 24))}, B has ${JSON.stringify(y.slice(k, k + 24))}`,
    )
}

if (diffs.length === 0) {
    for (const [i, t] of a.entries())
        if (!VERBOSE) console.log(`[${i}] ${norm(t)}`)
    console.log(
        `\nMATCH (${label}) — emitted markup is identical: tags, nesting, attribute names and values, and every text node.`,
    )
    if (MODULO_CLASS)
        console.log(
            `NOTE: class attributes were excluded by --modulo-class. This says NOTHING about whether they were converted correctly — pair it with bench/probeStory.ts or bench/moduleClassCheck.ts.`,
        )
    process.exit(0)
}
console.log(`MISMATCH (${label}) — ${diffs.length} difference(s):\n`)
for (const d of diffs) console.log(d + '\n')
process.exit(1)
