// app/src/icons/iconCallSites.test.ts
//
// WHY THIS EXISTS. `icons/registry.ts` renders a visible dashed-box-`?` placeholder (FALLBACK_ART)
// for any name it cannot resolve. That is the right runtime behaviour — better a visible mark than
// a silent gap — but it means a typo'd or renamed icon SHIPS, and ships into permanent chrome. On
// 2026-08-29 a design critique found twelve of them live at once: `TerminalSquare` in the FIRST ROW
// of the command palette, `circle-question-mark` beside "Sort by" and "Group by", `map-pin` on the
// event modal's LOCATION field. Every one rendered a `?` in a box directly next to a label, where
// it reads as a HELP AFFORDANCE — a user clicks it and nothing happens.
//
// None of the repo's existing gates could see it. `iconNames.test.ts` checks the manifest against
// itself; `bench/cssBaseline.ts` and `bench/invariants.ts` measure geometry and computed style, and
// a placeholder glyph has entirely normal geometry. The only signal was a human looking at a
// screenshot.
//
// So this test closes the loop from the other end: it walks the real call sites and asserts every
// icon-name literal actually resolves. It is deliberately a source scan rather than a runtime
// check, because most of these names sit in data tables (FIELDS_BY_TYPE, the recurrence scope list)
// that no story renders.
//
// WHAT IT CANNOT SEE, stated so a green run is not over-read: a name built at runtime
// (`icon={cond ? a : b}`, `icon={row.icon}`, a name read from frontmatter) is invisible to a
// regex over source. Those are legitimate — a vault note's `icon:` value is user data and MUST fall
// back gracefully — which is exactly why FALLBACK_ART stays. This covers the literals, which is
// where every one of the twelve lived.
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ICON_NAMES } from './iconNames'
import { createIconRegistry } from './registry-core'

const SRC = join(import.meta.dir, '..')

/** Resolve through the SAME registry the app uses, so an alias rule (…Icon, Li/Lu prefixes,
 *  case/separator insensitivity) that works at runtime is not reported as a failure here. */
const registry = createIconRegistry(
    Object.fromEntries(ICON_NAMES.map(n => [n, n])),
)

/** `<Icon value="X"` / `icon="X"` / `icon: 'X'` — the three shapes every call site in the tree
 *  uses. Only string LITERALS; an expression is skipped (see the header). */
const PATTERNS = [
    /\bvalue=["']([A-Za-z][\w-]*)["']/g,
    /\bicon=["']([A-Za-z][\w-]*)["']/g,
    /\bicon:\s*["']([A-Za-z][\w-]*)["']/g,
]

/** Props named `value`/`icon` that are not icons at all. Narrow and explicit: a broad skip list
 *  would let a real miss through, which is the one thing this test must not do. */
const NOT_ICONS = new Set([
    // <Select value="…"> / <TextInput value="…"> and friends carry arbitrary data.
    'true', 'false', 'none', 'auto', 'all', 'one', 'following', 'default',
])

/** Components whose `icon` prop is a LOGO-MARK basename (resolved to `/logos/<icon>.svg`), not a
 *  name in the icon registry. These are the 14 Bismuth marks enumerated in
 *  core/src/schema/settingsSchema.ts, a completely separate asset set — `hopper-crystal` is a
 *  correct value there and would be a miss here. Matching by component name rather than by the
 *  value keeps a genuinely mistyped registry name from hiding behind a permissive value list. */
const LOGO_MARK_COMPONENTS = /<(?:Lockup|WordmarkHero)[^>]*$/

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(e => {
        const p = join(dir, e)
        if (e === 'node_modules' || e === 'assets') return []
        if (statSync(p).isDirectory()) return walk(p)
        return /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : []
    })

test('every literal icon name in app/src resolves (no shipped FALLBACK_ART placeholders)', () => {
    const misses: string[] = []
    for (const file of walk(SRC)) {
        const text = readFileSync(file, 'utf8')
        // Only files that actually talk to the icon system; `value=` alone is far too common.
        if (!/\bIcon\b|\bicon[:=]/.test(text)) continue
        for (const re of PATTERNS) {
            re.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = re.exec(text))) {
                const name = m[1]!
                if (NOT_ICONS.has(name.toLowerCase())) continue
                // A `value=` hit only counts when it is on an <Icon>; otherwise it is a Select or
                // an input and has nothing to do with icons.
                const before = text.slice(Math.max(0, m.index - 220), m.index)
                if (
                    re.source.startsWith('\\bvalue') &&
                    !/<Icon[^>]*$/.test(before)
                )
                    continue
                if (LOGO_MARK_COMPONENTS.test(before)) continue
                if (registry.resolve(name)) continue
                const line = text.slice(0, m.index).split('\n').length
                misses.push(
                    `${file.slice(SRC.length + 1)}:${line}  "${name}" resolves to nothing -> renders the dashed-box "?" placeholder`,
                )
            }
        }
    }
    expect(misses.join('\n')).toBe('')
})
