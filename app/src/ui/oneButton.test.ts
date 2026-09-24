// The ONE-BUTTON guard (one-button plan, Task 10). A command a person clicks renders as
// TextButton / IconButton / IconTextButton / SegmentedToggle / ChipToggle — never a raw
// `<button>` element (JSX or `document.createElement('button')`) and never `ui/Button` (the
// internal base every one of those composes) reached directly. The two detectors are pure
// functions in `oneButtonGuard.ts`; this file is the file-tree scan + the allow-lists.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { hasRawButton, importsButtonBase } from './oneButtonGuard'

const SRC = join(import.meta.dir, '..')

/** Every production `.ts`/`.tsx` under app/src — stories, tests and `_*` fixtures are not what a
 *  person clicks in the shipped app, so they are not in scope for either check below. */
function productionFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return productionFiles(path)
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return []
        if (
            name.endsWith('.stories.tsx') ||
            name.endsWith('.stories.ts') ||
            name.endsWith('.test.ts') ||
            name.endsWith('.test.tsx')
        )
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

/** Strips `//` and `/* *\/` comments before scanning for a raw button — a doc comment
 *  describing what a component USED TO hand-roll (ChipToggle, Swatch, OptionRow all carry one)
 *  is prose, not markup, and must not read as a violation. */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** Files allowed to render a raw button element outside `ui/Button.tsx`/`ui/PlainButton.tsx`
 *  (always allowed — see below), one entry per file with the reason it is not a command button.
 *  Computed from `grep -rln "<button\|createElement('button'" app/src --include='*.tsx'
 *  --include='*.ts'` minus stories/tests/`_*`, minus comment-only hits (a plain string search
 *  over that grep's output includes several files whose ONLY mention is prose in a doc comment —
 *  `stripComments` above is what tells those apart). */
const RAW_BUTTON_ALLOW: Readonly<Record<string, string>> = {
    'ui/FormControl.tsx':
        "Select's trigger — a polymorphic input/textarea/button form-control chrome, not a command",
    'ui/OptionRow.tsx':
        'a sentence-case two-line full-width choice row — its own primitive, not a label button',
    'ui/Swatch.tsx':
        'an accessible colour-picker swatch/chip square — a picker, not a text/icon command',
    // Imperative `document.createElement('button')` — CodeMirror widgets build raw DOM outside
    // the Solid tree, so there is no Button/TextButton to compose here. Known follow-up (Finding
    // 1 in this task's review), not endorsed: flagged for a future migration, not fixed here.
    'bases/CardEditor.tsx': 'a CodeMirror WidgetType.toDOM fold-toggle — plain-DOM, outside Solid',
    'editor/findPanel.ts': 'a CodeMirror search Panel built as raw DOM — plain-DOM, outside Solid',
    'editor/tableWidget.ts':
        'CodeMirror table row/column controls built as raw DOM — plain-DOM, outside Solid',
}

const ALWAYS_ALLOWED_RAW_BUTTON = new Set([
    'ui/Button.tsx',
    'ui/PlainButton.tsx',
    // The detector's own source: `hasRawButton`'s JSX regex literal spells `<button\b`, which
    // matches its own pattern when this file scans itself. It renders nothing.
    'ui/oneButtonGuard.ts',
])

describe('oneButtonGuard pure detectors', () => {
    it('hasRawButton catches a JSX <button>', () => {
        expect(hasRawButton('<button>x</button>')).toBe(true)
    })

    it('hasRawButton catches an imperative document.createElement(\'button\')', () => {
        expect(hasRawButton("document.createElement('button')")).toBe(true)
    })

    it('hasRawButton ignores a composed <Button>', () => {
        expect(hasRawButton('<Button>')).toBe(false)
    })

    it("importsButtonBase matches an import of '../ui/Button'", () => {
        expect(importsButtonBase("import { Button } from '../ui/Button'")).toBe(true)
    })

    it("importsButtonBase matches an import of './Button.tsx'", () => {
        expect(importsButtonBase("import Button from './Button.tsx'")).toBe(true)
    })

    it("importsButtonBase does not match an import of './IconButton'", () => {
        expect(importsButtonBase("import IconButton from './IconButton'")).toBe(false)
    })
})

describe('a second button look — compose TextButton / IconButton / IconTextButton', () => {
    it('no production file outside the Button family renders a raw <button> element', () => {
        const offenders = productionFiles(SRC).flatMap(file => {
            const rel = relative(SRC, file)
            if (ALWAYS_ALLOWED_RAW_BUTTON.has(rel) || rel in RAW_BUTTON_ALLOW) return []
            const clean = stripComments(readFileSync(file, 'utf8'))
            return hasRawButton(clean) ? [rel] : []
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
            // This file: importsButtonBase's own unit-test fixtures are literal
            // "from '../ui/Button'" / "from './Button.tsx'" strings, not real imports.
            'ui/oneButton.test.ts',
        ])
        const offenders = allSourceFiles(SRC).flatMap(file => {
            const rel = relative(SRC, file)
            if (ALLOWED_IMPORTERS.has(rel)) return []
            return importsButtonBase(readFileSync(file, 'utf8')) ? [rel] : []
        })
        expect(offenders).toEqual([])
    })
})
