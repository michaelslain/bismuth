// Pins the fix for the outside-click bug that used to live in
// bases/PropertyValueEditor.tsx's MultiSelectEditor: its document pointerdown guard matched
// the Select backdrop by the CSS-module class literal `.ui-select-backdrop`. A module class
// is HASHED at build time, so that literal matched NOTHING — clicking the backdrop (meant
// only to close the Select's own option list) fell through to "click outside the whole
// editor" and tore down the entire multiselect editor.
//
// MultiSelectEditor has since been replaced by ui/TagsField.tsx (a single-line editor with the
// note editor's completion popup), which has no document pointerdown guard at all. So this no
// longer pins a guard's wiring; it pins that the hashed-class literal never comes back, in
// either file, and that any `closest(` call that does exist matches the runtime data-attribute
// hook rather than a class name.
//
// Solid components can't be mounted under `bun test` here (solid-js/web resolves to its
// server build — see CLAUDE.md), so this is a source-level check in the spirit of
// cssLayering.test.ts / moduleClassCheck.ts: it reads the actual files as text.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const selectSrc = readFileSync(join(import.meta.dir, 'Select.tsx'), 'utf8')
const editorSrc = readFileSync(
    join(import.meta.dir, '../bases/PropertyValueEditor.tsx'),
    'utf8',
)
const tagsFieldSrc = readFileSync(join(import.meta.dir, 'TagsField.tsx'), 'utf8')

describe('Select backdrop — dismiss hook survives CSS-module hashing', () => {
    it('the backdrop element carries the data-select-backdrop attribute', () => {
        const lines = selectSrc.split('\n')
        const at = lines.findIndex(l =>
            l.includes("styles['ui-select-backdrop']"),
        )
        expect(at).toBeGreaterThanOrEqual(0)
        // The class + the data attribute + onClick are three attributes of the same JSX
        // element — look a couple of lines either side rather than requiring one line.
        const around = lines.slice(Math.max(0, at - 2), at + 3).join('\n')
        expect(around).toContain('data-select-backdrop')
    })

    it('neither PropertyValueEditor nor TagsField reaches the backdrop by its hashed class, and any closest() call targets the data attribute', () => {
        for (const src of [editorSrc, tagsFieldSrc]) {
            // The old literal matched nothing at runtime — guard against it coming back.
            expect(src).not.toContain('.ui-select-backdrop')
            const closestCalls = src.match(/closest\(([^)]*)\)/g) ?? []
            for (const call of closestCalls) {
                expect(call).toContain('[data-select-backdrop]')
            }
        }
    })
})
