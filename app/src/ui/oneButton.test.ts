// The ONE-BUTTON guard (one-button plan, Task 10). A command a person clicks renders as
// TextButton / IconButton / IconTextButton / SegmentedToggle / ChipToggle — never a raw
// `<button>` and never `ui/Button` (the internal base every one of those composes) reached
// directly. Pure: no framework, no DOM — the tests hand it file text read off disk.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..')

/** Every production `.tsx` under app/src — stories, tests and `_*` fixtures are not what a
 *  person clicks in the shipped app, so they are not in scope for either check below. */
function productionFiles(dir: string, ext: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return productionFiles(path, ext)
        if (!name.endsWith(ext)) return []
        if (name.endsWith('.stories.tsx') || name.endsWith('.test.ts') || name.endsWith('.test.tsx'))
            return []
        if (name.startsWith('_')) return []
        return [path]
    })
}

/** Every `.ts`/`.tsx` under app/src, INCLUDING stories/tests — an import is an import wherever
 *  it is written, and Button's own story is one of the two files this plan names as allowed. */
function allSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return allSourceFiles(path)
        if (name.endsWith('.tsx') || name.endsWith('.ts')) return [path]
        return []
    })
}

/** Strips `//` and `/* *\/` comments before scanning for a raw `<button` — a doc comment
 *  describing what a component USED TO hand-roll (ChipToggle, Swatch, OptionRow all carry one)
 *  is prose, not markup, and must not read as a violation. */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** Files allowed to render a raw `<button` element outside `ui/Button.tsx`/`ui/PlainButton.tsx`
 *  (always allowed — see below), one entry per file with the reason it is not a command button.
 *  Computed from `grep -rln "<button" app/src --include='*.tsx'` minus stories/tests/`_*`, minus
 *  comment-only hits (a plain string search over that grep's output includes several files whose
 *  ONLY mention is prose in a doc comment — `stripComments` above is what tells those apart). */
const RAW_BUTTON_ALLOW: Readonly<Record<string, string>> = {
    'ui/FormControl.tsx':
        "Select's trigger — a polymorphic input/textarea/button form-control chrome, not a command",
    'ui/OptionRow.tsx':
        'a sentence-case two-line full-width choice row — its own primitive, not a label button',
    'ui/Swatch.tsx':
        'an accessible colour-picker swatch/chip square — a picker, not a text/icon command',
}

const ALWAYS_ALLOWED_RAW_BUTTON = new Set(['ui/Button.tsx', 'ui/PlainButton.tsx'])

describe('a second button look — compose TextButton / IconButton / IconTextButton', () => {
    it('no production file outside the Button family renders a raw <button> element', () => {
        const offenders = productionFiles(SRC, '.tsx').flatMap(file => {
            const rel = relative(SRC, file)
            if (ALWAYS_ALLOWED_RAW_BUTTON.has(rel) || rel in RAW_BUTTON_ALLOW) return []
            const clean = stripComments(readFileSync(file, 'utf8'))
            return /<button\b/.test(clean) ? [rel] : []
        })
        expect(offenders).toEqual([])
    })

    it('only the Button family and SegmentedToggle/ChipToggle import ui/Button directly', () => {
        // Composes ui/Button directly, by design — this IS the Button family.
        const ALLOWED_IMPORTERS = new Set([
            'ui/Button.tsx',
            'ui/Button.stories.tsx',
            'ui/TextButton.tsx',
            'ui/IconButton.tsx',
            'ui/IconTextButton.tsx',
            'ui/SegmentedToggle.tsx',
            'ui/ChipToggle.tsx',
            // Found, not acted on (Task 10 report): pre-existing story-only demo usages and one
            // production picker-cell (arbitrary icon/emoji glyph cells with no fixed `icon` name,
            // so IconButton's typed `icon` prop cannot express them) — none of these were touched
            // by this migration and are out of this task's files.
            'ui/AnchoredPopover.stories.tsx',
            'ui/Modal.stories.tsx',
            'ui/gallery/SymbolGallery.tsx',
            'ui/gallery/SymbolGallery.stories.tsx',
        ])
        const IMPORT_FROM = /from\s+['"]([^'"]+)['"]/g
        const offenders = allSourceFiles(SRC).flatMap(file => {
            const rel = relative(SRC, file)
            if (ALLOWED_IMPORTERS.has(rel)) return []
            const text = readFileSync(file, 'utf8')
            for (const m of text.matchAll(IMPORT_FROM)) {
                const path = m[1]!
                const last = path.split('/').pop()
                if (last === 'Button') return [rel]
            }
            return []
        })
        expect(offenders).toEqual([])
    })
})
