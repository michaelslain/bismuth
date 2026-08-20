/**
 * bench/affected.ts — which stories does the current diff actually touch?
 *
 * WHY. A full visual sweep is ~33 minutes, which is why it stopped being run and why regressions had
 * room to accumulate. Almost every change touches a handful of components, so gating the whole
 * catalogue is wasted time AND a bad trade: the slow gate gets skipped, and skipping it protects
 * nothing. This maps changed files to the stories that can actually render them, so the common case
 * is seconds.
 *
 * MAPPING RULES, in order of confidence:
 *   Foo.stories.tsx      -> the stories in that file (it IS the story)
 *   Foo.tsx              -> Foo.stories.tsx if it exists
 *   Foo.module.css       -> Foo.stories.tsx (colocated by convention)
 *   ui/ui.css, App.css   -> EVERYTHING. These are global; scoping them would be a lie.
 *   theme/tokens.ts      -> EVERYTHING, same reason.
 *
 * A file with no story maps to nothing and is REPORTED, not silently ignored — "no stories matched"
 * must never look the same as "nothing to check".
 *
 * Usage:
 *   bun bench/affected.ts                       # vs HEAD (working tree)
 *   bun bench/affected.ts --base main           # vs another ref
 *   bun bench/affected.ts --range A B           # between two refs, ignoring the working tree
 *   bun bench/affected.ts --files a.tsx,b.css   # an explicit list (testing, or a scripted caller)
 *   bun bench/affected.ts --prefixes            # emit --story prefixes, one per line
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
        ? process.argv[i + 1]!
        : d
}
const has = (n: string) => process.argv.includes(`--${n}`)

const ROOT = join(import.meta.dir, '..')
const BASE_REF = arg('base', 'HEAD')

const EXPLICIT = arg('files')
const RANGE = arg('range')
const gitArgs = RANGE
    ? ['diff', '--name-only', RANGE, process.argv[process.argv.indexOf('--range') + 2] ?? 'HEAD']
    : ['diff', '--name-only', BASE_REF]
const files = EXPLICIT
    ? EXPLICIT.split(',').map(f => f.trim()).filter(Boolean)
    : (
          await new Response(
              Bun.spawn(['git', '-C', ROOT, ...gitArgs]).stdout,
          ).text()
      )
          .split('\n')
          .filter(Boolean)
const appFiles = files.filter(f => f.startsWith('app/src/'))

/** Files whose reach is the entire catalogue. Scoping a global stylesheet or the token source to a
 *  subset would produce a green run that proves nothing. */
const GLOBAL = [
    'app/src/ui/ui.css',
    'app/src/App.css',
    'app/src/ui/popover/popover.css',
    'core/src/theme/tokens.ts',
    'app/.storybook/preview.ts',
]
const isGlobal = files.some(f => GLOBAL.includes(f))

const storyFileFor = (f: string): string | null => {
    if (f.endsWith('.stories.tsx')) return f
    const dir = dirname(f)
    const stem = basename(f).replace(/\.(tsx|ts|module\.css|css)$/, '')
    const cand = join(dir, `${stem}.stories.tsx`)
    return existsSync(join(ROOT, cand)) ? cand : null
}

const titleOf = (storyFile: string): string | null => {
    const src = readFileSync(join(ROOT, storyFile), 'utf8')
    const m = /title:\s*['"]([^'"]+)['"]/.exec(src)
    return m ? m[1]! : null
}

/** Storybook derives an id by lowercasing the title and replacing non-alphanumerics with '-'. */
const idPrefix = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

if (isGlobal) {
    const hit = files.filter(f => GLOBAL.includes(f))
    console.error(`GLOBAL file changed (${hit.join(', ')}) — every story is affected, no scoping possible.`)
    if (has('prefixes')) console.log('') // empty prefix = all stories
    process.exit(0)
}

const prefixes = new Set<string>()
const unmapped: string[] = []
for (const f of appFiles) {
    const sf = storyFileFor(f)
    if (!sf) { unmapped.push(f); continue }
    const t = titleOf(sf)
    if (!t) { unmapped.push(f); continue }
    prefixes.add(idPrefix(t))
}

if (has('prefixes')) {
    for (const p of [...prefixes].sort()) console.log(p)
} else {
    console.log(`changed app files: ${appFiles.length}`)
    console.log(`story prefixes affected: ${prefixes.size}`)
    for (const p of [...prefixes].sort()) console.log(`  ${p}`)
    if (unmapped.length) {
        console.log(`\nNO STORY COVERS THESE ${unmapped.length} FILE(S) — visual changes here are UNVERIFIED:`)
        for (const f of unmapped) console.log(`  ${f}`)
    }
}
