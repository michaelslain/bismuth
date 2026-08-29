// bench/tokenLint.ts — literal-value lint for app/src stylesheets: wave 0's self-policing gate.
//
// WHY THIS EXISTS. The 2026-08-27 visual-unification audit's wave 0 built the scale (--sp-1..7,
// --h-row/--h-control/--h-band, --icon, --r-0, --state-*, --rule*) but landing a scale changes
// nothing by itself — nine more waves have to actually SWEEP ~40 stylesheets onto it, one surface
// at a time, over however many sessions that takes. Without a check, "did this wave introduce a
// NEW magic number while fixing its own surface" is answerable only by re-reading a diff by eye,
// and the thing this repo already learned the hard way (bench/cssBaseline.ts's header) is that a
// check nobody runs might as well not exist. This is the grep the audit itself asked for: "a
// bench/ invariant that greps for literal border-radius: / padding: px in *.module.css would make
// every later wave self-policing."
//
// WHAT IT CHECKS, in every app/src/**/*.css and app/src/**/*.module.css declaration:
//   1. border-radius (any longhand corner too) with a non-zero PX value. `50%` survives — a
//      circle is a shape, not a softened corner (see §9.2 of the audit: --r-1 was rejected;
//      radius is 0 everywhere except genuine dots).
//   2. padding / margin / gap (and their longhands: -top/-inline-start/etc, plus row-gap /
//      column-gap / inset) with a literal non-zero PX value. `var(--sp-N)` is not a literal and
//      never matches; a raw px number is flagged even when it happens to equal a scale step,
//      because the point is CONSUMING THE TOKEN, not merely rendering the same pixel by luck.
//   3. font-size with a literal PX value (em/rem/%/var() are not this check's business).
//   4. box-shadow whose blur radius (the third length in `x y blur spread color`) is non-zero.
//      `--lift: 2px 2px 0 var(--shadow-hard)` — zero blur — is the sanctioned shape (§9.3); the
//      four deleted `--shadow-menu/-popup/-card/-modal` tokens are the target, not this check's
//      business directly (they are core/src/theme/tokens.ts + custom-property VALUES, not a
//      `box-shadow:` declaration — see `checksCustomProps` on the `Rule` type below for why
//      custom properties are exempt from checks 1-5).
//   5. backdrop-filter at all (any value other than literally `none`) — the audit calls for ALL
//      five sites deleted, not tuned, so there is no "acceptable" blur radius to allow.
//   6. literal hex (#abc / #aabbcc / #aabbccdd) or rgb()/rgba() with numeric (not var()) channels,
//      in ANY declaration's value, standard property or custom property alike — this is the one
//      check that DOES look inside custom-property definitions, because a component inventing its
//      own hardcoded color (ExportView.css's `--paper-bg: #f7f6f2`) is exactly the drift the color
//      system is otherwise free of.
//
// WHY CUSTOM PROPERTIES (`--foo: …`) ARE EXEMPT FROM CHECKS 1-5 BUT NOT CHECK 6. A custom property
// declaration is the TOKEN LAYER ITSELF — `styles/tokens.css` is who is ALLOWED to write
// `--shadow-card: 0 1px 0 rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35)`, because that literal only
// becomes a violation at the moment some component's `box-shadow:` reads it, and by design every
// component here reads it through `var(--shadow-card)` (checked: no component-level box-shadow
// in this repo currently ships a literal blurred shadow — the blur lives entirely in the token
// file, which is core/src/theme/tokens.ts's problem, outside app/src, and the token file's own
// custom-property value, which check 6 does NOT re-flag as a shadow violation but WOULD flag if it
// contained a bare hex it didn't already carry a documented exemption for). Colour is the one axis
// where a token file hardcoding a value and a component hardcoding a value are the SAME mistake
// (drift), so check 6 applies uniformly.
//
// THE BASELINE, AND WHY IT IS PER (file, rule, exact-literal-value) RATHER THAN PER (file, rule).
// This repo is starting from ~40 unswept stylesheets and will be for nine more waves (see the
// audit's §7). A check that fails loudly on everything from day one gets `BISMUTH_SKIP_GATE=1`'d
// into irrelevance — the same lesson bench/cssBaseline.ts already paid for. So known-current
// violations are recorded once, as a committed baseline (token-lint-baseline.json), and a run only
// FAILS on a violation with no matching baseline entry — a genuinely NEW magic number, not the
// ~700 that already exist.
//
// The key is (file, rule, exact declaration text) with a COUNT, not just (file, rule): fixing 4 of
// FileTree's 6 `padding: 8px` literals should never mask a 7th, DIFFERENT literal (`padding: 5px`)
// appearing in the same file for the same rule — a coarser (file, rule) key would let that through
// as "still under budget". Per-(file,rule) alone was tried first in the design of this tool and
// rejected for exactly that blind spot. What this key still cannot catch: a literal that moves to
// a DIFFERENT LINE in a file that already has that same value elsewhere (e.g. two "padding: 8px"
// rules, one deleted and a new unrelated one added at the same file+rule+text) — the count stays
// flat and the check stays green. That is a real, accepted gap: distinguishing "this exact edit"
// from "an edit that happens to net to the same literal" needs a git-blame-level tool, not a static
// sweep, and would fail on the ordinary case of one rule genuinely having six equal-looking
// instances today. Read the findings dump when in doubt, don't trust the exit code alone for a
// surgical review.
//
// Progress is legible without touching the baseline: every run prints CURRENT vs BASELINE totals
// per rule, so a wave that fixes violations sees the number drop even before anyone re-blesses.
// Blessing (`--bless`) is a deliberate step — like this repo's `test:bless-schema` — taken at the
// END of a wave that swept a surface, to lock the new lower count in as the floor so a later
// regression back toward the old number is caught too. Nothing here auto-shrinks the committed
// file; a run that merely improves things still exits 0 without being blessed.
//
// NOT WIRED INTO THE PRE-COMMIT GATE THIS WAVE. See `bun run gate` / `.githooks/pre-commit` — this
// check is deliberately left OUT of both hooks for now: work-in-progress waves need to touch files
// this check watches without every commit failing mid-sweep. Wave 9 (the componentization/backlog
// wave, the last one in the plan) is the right point to promote it into `scripts/gate.ts` — by then
// every surface has had its own wave and the baseline should be at or near zero.
//
// Usage:
//   bun bench/tokenLint.ts                 # check: NEW violations only, exit 1 if any
//   bun bench/tokenLint.ts --list           # every CURRENT violation, grouped by file (pick up a
//                                           #   surface's todo list — add --file <substr> to scope)
//   bun bench/tokenLint.ts --rule hex-color # scope either mode to one rule
//   bun bench/tokenLint.ts --json           # machine-readable
//   bun bench/tokenLint.ts --bless          # overwrite the baseline with the CURRENT violation set
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
        ? process.argv[i + 1]!
        : d
}
const has = (n: string) => process.argv.includes(`--${n}`)

const ROOT = join(import.meta.dir, '..')
const SRC = join(ROOT, 'app', 'src')
const BASELINE_PATH = join(import.meta.dir, 'token-lint-baseline.json')
/** Full findings dump. Generated, gitignored, overwritten every failing run and DELETED on a clean
 *  one — same contract as css-baseline.drift.txt / module-class-check.txt, for the same reason: a
 *  stale dump beside a passing run gets grepped and believed. */
const DUMP = join(import.meta.dir, 'token-lint.drift.txt')

const RULE_FILTER = arg('rule')
const FILE_FILTER = arg('file')

// ---------------------------------------------------------------------------------------------
// Files this tool does not police, and why.
// ---------------------------------------------------------------------------------------------
/** Relative to app/src. GENERATED files carry no hand-authored literals to sweep — their "magic
 *  numbers" are an upstream library's SVG paths, re-emitted verbatim by a codegen script. */
const SKIP_FILES = new Set<string>([
    // sheet/univer-icons.css's own header: "GENERATED by gen-univer-icons.ts — do not edit by
    // hand." Its content is `-webkit-mask: url("data:image/svg+xml,...")` — percent-encoded SVG
    // markup (a literal `#` becomes `%23`), so today it trips nothing here anyway; skipped by
    // name so a future regeneration that inlines a raw color can't silently join the baseline.
    'sheet/univer-icons.css',
])

/** Files where a literal colour is a DOCUMENTED, sanctioned exception — not drift to eventually
 *  fix, so check 6 does not run on them at all (a permanent skip, unlike the baseline's per-value
 *  entries which are always implicitly "fix this eventually"). */
const COLOR_EXEMPT_FILES = new Set<string>([
    // styles/tokens.css's own header: this file's hex/rgba literals are the deliberate first-paint
    // :root fallbacks that MUST byte-match core/src/theme/tokens.ts (themeGuard.test.ts enforces
    // that match already — this tool would just re-litigate a decision already guarded elsewhere).
    'styles/tokens.css',
])

// ---------------------------------------------------------------------------------------------
// Walk app/src for the two globs the audit named.
// ---------------------------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === 'dist') continue
        const p = join(dir, e)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (e.endsWith('.css')) out.push(p)
    }
    return out
}
const allCssFiles = walk(SRC)
    .map(f => relative(SRC, f))
    .filter(f => !SKIP_FILES.has(f))
    .sort()

// ---------------------------------------------------------------------------------------------
// Declaration extraction.
// ---------------------------------------------------------------------------------------------
/** Blank out comments IN PLACE (newlines kept, everything else turned to a space) so every match
 *  index below still lines up with the ORIGINAL file's line numbers. This is also what keeps
 *  false positives like `/* ... (#104) ... *\/`-style issue references (real content in this repo
 *  — BaseView.module.css, Calendar.module.css) from ever reaching the hex-colour regex: they are
 *  comment text, not a declaration value. */
function blankComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

type Decl = { property: string; value: string; index: number }
/** Every `property: value;` in a file, selectors and braces excluded by construction — a selector
 *  has no top-level `;`, so `[^;{}]+;` cannot span into one. Good enough for real CSS; it does not
 *  need to be a full parser to answer "is this literal on the token scale or not". */
function declarations(css: string): Decl[] {
    const out: Decl[] = []
    for (const m of css.matchAll(/([A-Za-z-]+)\s*:\s*([^;{}]+);/g))
        out.push({ property: m[1]!.toLowerCase(), value: m[2]!.trim(), index: m.index! })
    return out
}
function lineOf(css: string, index: number): number {
    let n = 1
    for (let i = 0; i < index; i++) if (css[i] === '\n') n++
    return n
}

// ---------------------------------------------------------------------------------------------
// Per-rule matchers. Each returns a short "detail" string (the exact literal) when it finds a
// violation, or null when the declaration is clean.
// ---------------------------------------------------------------------------------------------
const RADIUS_PROP = /^(-webkit-|-moz-)?border(-(top|bottom)-(left|right))?-radius$/
/** padding/margin/gap and every longhand (-top, -inline-start, …) plus row-gap/column-gap/inset. */
const SPACING_PROP = /^(padding|margin|gap|row-gap|column-gap|inset)(-[a-z]+)*$/
const PX_TOKEN = /^-?\d*\.?\d+px$/
const nonZeroPx = (tok: string) => PX_TOKEN.test(tok) && parseFloat(tok) !== 0

function checkRadius(value: string): string | null {
    if (value.trim() === '50%') return null // a genuine circular dot, not a softened corner
    const bad = value.split(/\s+/).filter(nonZeroPx)
    return bad.length ? value : null
}
function checkSpacing(value: string): string | null {
    const bad = value.split(/\s+/).filter(nonZeroPx)
    return bad.length ? value : null
}
function checkFontSize(value: string): string | null {
    return nonZeroPx(value.trim()) ? value : null
}
/** True if this box-shadow VALUE has a non-zero blur radius in any of its comma-separated layers.
 *  Reads only the LEADING run of plain length tokens in each layer (offset-x offset-y blur
 *  spread), stopping at the first token that is not a bare length — which is always where the
 *  colour starts (`var(--x)`, `rgba(...)`, `color-mix(...)`, `currentColor`, a hex, `inset` is
 *  stripped first). This sidesteps a real trap: naively stripping "colour functions" with a
 *  non-nesting-aware regex mangles `color-mix(in srgb, var(--x) 45%, transparent)` (nested parens)
 *  and can leave a stray "45" behind to be miscounted as a length — this approach never looks past
 *  the first non-numeric token, so it never sees that far. */
function shadowLayerBlur(layer: string): number | null {
    const toks = layer.trim().replace(/^inset\s+/i, '').split(/\s+/)
    const lens: number[] = []
    for (const t of toks) {
        if (/^-?\d*\.?\d+(px)?$/.test(t)) lens.push(parseFloat(t))
        else break
    }
    return lens.length >= 3 ? lens[2]! : null
}
function splitTopLevel(s: string, sep: string): string[] {
    const out: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of s) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
        if (ch === sep && depth === 0) {
            out.push(cur)
            cur = ''
        } else cur += ch
    }
    out.push(cur)
    return out
}
function checkBoxShadow(value: string): string | null {
    if (/^\s*none\s*$/i.test(value)) return null
    for (const layer of splitTopLevel(value, ',')) {
        const blur = shadowLayerBlur(layer)
        if (blur !== null && blur !== 0) return value
    }
    return null
}
function checkBackdropFilter(value: string): string | null {
    return /^\s*none\s*$/i.test(value) ? null : value
}
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/
const RGB_FN = /\brgba?\(\s*[0-9.]/
function checkColor(value: string): string | null {
    const hex = value.match(HEX_COLOR)
    if (hex) return hex[0]
    const rgb = value.match(RGB_FN)
    if (rgb) return value
    return null
}

type Rule = {
    id: string
    label: string
    /** Does this declaration's PROPERTY belong to this rule at all? */
    props: (prop: string) => boolean
    /** Custom-property (`--x`) declarations are the token layer itself — see the header comment —
     *  so structural rules (1-5) skip them; only the colour rule (6) reads inside them. */
    checksCustomProps: boolean
    check: (value: string) => string | null
}
const RULES: Rule[] = [
    {
        id: 'radius-literal',
        label: 'border-radius: literal non-zero px (want --r-0 / 50% only)',
        props: p => RADIUS_PROP.test(p),
        checksCustomProps: false,
        check: checkRadius,
    },
    {
        id: 'spacing-literal',
        label: 'padding/margin/gap: literal px (want --sp-1..7)',
        props: p => SPACING_PROP.test(p),
        checksCustomProps: false,
        check: checkSpacing,
    },
    {
        id: 'font-size-literal',
        label: 'font-size: literal px (want the type scale)',
        props: p => p === 'font-size',
        checksCustomProps: false,
        check: checkFontSize,
    },
    {
        id: 'shadow-blur',
        label: 'box-shadow: non-zero blur radius (want --lift, zero blur)',
        props: p => p === 'box-shadow' || p === '-webkit-box-shadow',
        checksCustomProps: false,
        check: checkBoxShadow,
    },
    {
        id: 'backdrop-filter',
        label: 'backdrop-filter: present at all (want none — deleted per the audit)',
        props: p => p === 'backdrop-filter' || p === '-webkit-backdrop-filter',
        checksCustomProps: false,
        check: checkBackdropFilter,
    },
    {
        id: 'hex-color',
        label: 'hex / rgb() literal colour (want a var() from core/src/theme/tokens.ts)',
        props: () => true, // any property, INCLUDING custom properties — see checksCustomProps
        checksCustomProps: true,
        check: checkColor,
    },
]
const rulesToRun = RULE_FILTER ? RULES.filter(r => r.id === RULE_FILTER) : RULES
if (RULE_FILTER && rulesToRun.length === 0) {
    console.error(
        `no such rule "${RULE_FILTER}" — known rules: ${RULES.map(r => r.id).join(', ')}`,
    )
    process.exit(2)
}

// ---------------------------------------------------------------------------------------------
// Sweep.
// ---------------------------------------------------------------------------------------------
type Finding = { file: string; rule: string; detail: string; line: number }
const findings: Finding[] = []
for (const rel of allCssFiles) {
    if (FILE_FILTER && !rel.includes(FILE_FILTER)) continue
    const raw = readFileSync(join(SRC, rel), 'utf8')
    const clean = blankComments(raw)
    for (const d of declarations(clean)) {
        const isCustom = d.property.startsWith('--')
        for (const rule of rulesToRun) {
            if (isCustom && !rule.checksCustomProps) continue
            if (rule.id === 'hex-color' && COLOR_EXEMPT_FILES.has(rel)) continue
            if (!isCustom && !rule.props(d.property)) continue
            const detail = rule.check(d.value)
            if (detail !== null)
                findings.push({
                    file: rel,
                    rule: rule.id,
                    detail: detail.replace(/\s+/g, ' ').trim(),
                    line: lineOf(clean, d.index),
                })
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Baseline compare -- key is (file, rule, exact literal), see header comment for why. The KEY
// STRING is only ever used for Map identity/lookup, never parsed back apart -- `detail` routinely
// contains spaces ("0 1px 0 rgba(0,0,0,.3)"), so reconstructing fields by splitting the key
// would silently truncate it. Every field a report needs is carried on the map's VALUE instead.
// ---------------------------------------------------------------------------------------------
type Counted = { file: string; rule: string; detail: string; count: number }
const key = (f: string, r: string, d: string) => JSON.stringify([f, r, d])

const currentCounts = new Map<string, Counted>()
for (const f of findings) {
    const k = key(f.file, f.rule, f.detail)
    const existing = currentCounts.get(k)
    if (existing) existing.count++
    else currentCounts.set(k, { file: f.file, rule: f.rule, detail: f.detail, count: 1 })
}

let baseline: Counted[] = []
if (existsSync(BASELINE_PATH)) {
    try {
        baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    } catch {
        console.error(`${BASELINE_PATH} is not valid JSON -- treating as empty (everything is NEW)`)
    }
}
const baselineCounts = new Map<string, number>()
for (const b of baseline) baselineCounts.set(key(b.file, b.rule, b.detail), b.count)

if (has('bless')) {
    const entries = [...currentCounts.values()].sort(
        (a, b) =>
            a.file.localeCompare(b.file) ||
            a.rule.localeCompare(b.rule) ||
            a.detail.localeCompare(b.detail),
    )
    writeFileSync(BASELINE_PATH, JSON.stringify(entries, null, 1) + '\n')
    console.log(
        `blessed ${entries.length} known-violation entries (${findings.length} total occurrences) -> ${relative(ROOT, BASELINE_PATH)}`,
    )
    process.exit(0)
}

// ---------------------------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------------------------
if (has('list')) {
    const byFile = new Map<string, Finding[]>()
    for (const f of findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, [])
        byFile.get(f.file)!.push(f)
    }
    if (has('json')) {
        console.log(JSON.stringify([...byFile.entries()], null, 1))
    } else {
        for (const [file, fs] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
            console.log(`\n${file} — ${fs.length}`)
            for (const f of fs.sort((a, b) => a.line - b.line))
                console.log(`  L${f.line}  ${f.rule.padEnd(16)}  ${f.detail}`)
        }
        console.log(`\n${findings.length} current violation(s) across ${byFile.size} file(s)`)
    }
    process.exit(0)
}

/** Sum of just the EXCESS over baseline, per key -- this is what "new" means, not the raw current
 *  count (which mostly just IS the accepted baseline). Values carry the fields directly; the key
 *  itself is never parsed apart (see the comment above `key()`). */
let newCount = 0
const newFindings = new Map<string, Counted & { excess: number }>()
for (const [k, cur] of currentCounts) {
    const base = baselineCounts.get(k) ?? 0
    if (cur.count > base) {
        newCount += cur.count - base
        newFindings.set(k, { ...cur, excess: cur.count - base })
    }
}

const ruleTotals = new Map<string, { current: number; baseline: number }>()
for (const r of rulesToRun) ruleTotals.set(r.id, { current: 0, baseline: 0 })
for (const cur of currentCounts.values())
    if (ruleTotals.has(cur.rule)) ruleTotals.get(cur.rule)!.current += cur.count
for (const b of baseline) if (ruleTotals.has(b.rule)) ruleTotals.get(b.rule)!.baseline += b.count

if (has('json')) {
    console.log(
        JSON.stringify(
            {
                newCount,
                totalCurrent: findings.length,
                totalBaseline: baseline.reduce((a, b) => a + b.count, 0),
                ruleTotals: Object.fromEntries(ruleTotals),
                newFindings: [...newFindings.values()].map(({ file, rule, detail, excess }) => ({
                    file,
                    rule,
                    detail,
                    excess,
                })),
            },
            null,
            1,
        ),
    )
} else {
    console.log('token lint -- literal values in app/src/**/*.css against the wave-0 scale\n')
    for (const r of rulesToRun) {
        const t = ruleTotals.get(r.id)!
        const delta = t.current - t.baseline
        const arrow = delta === 0 ? '=' : delta < 0 ? `${delta} (shrinking)` : `+${delta}`
        console.log(
            `  ${r.id.padEnd(16)} current ${String(t.current).padStart(4)}   baseline ${String(t.baseline).padStart(4)}   ${arrow}`,
        )
        console.log(`  ${''.padEnd(16)} ${r.label}`)
    }
    const scope = `${RULE_FILTER ? `scoped to rule "${RULE_FILTER}"` : `${rulesToRun.length} rules`}${FILE_FILTER ? `, files matching "${FILE_FILTER}"` : ''}`
    console.log(`\n  ${scope}`)

    if (newFindings.size) {
        console.log(`\nNEW violations not in the baseline -- ${newCount} occurrence(s), ${newFindings.size} distinct:`)
        const lines: string[] = []
        for (const { file, rule, detail, excess } of newFindings.values()) {
            const sample = findings.find(f => f.file === file && f.rule === rule && f.detail === detail)
            const loc = sample ? `L${sample.line}` : '?'
            const line = `  ${file}  ${loc}  [${rule}]  ${detail}${excess > 1 ? `  (x${excess})` : ''}`
            console.log(line)
            lines.push(line)
        }
        writeFileSync(DUMP, lines.join('\n') + '\n')
        console.log(`\nfull list -> ${relative(ROOT, DUMP)}`)
        console.log(
            `\nIf this literal is deliberate and known, either fix it (preferred -- use the token) or\n` +
                `run "bun bench/tokenLint.ts --bless" to accept it into the baseline explicitly.`,
        )
    } else {
        console.log('\nno NEW violations -- every current literal matches the recorded baseline')
        try {
            rmSync(DUMP, { force: true })
        } catch {}
    }
}

process.exit(newCount ? 1 : 0)
