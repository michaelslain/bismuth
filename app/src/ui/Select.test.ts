// Pins the fix for the outside-click bug in bases/PropertyValueEditor.tsx: its document
// pointerdown guard used to match the Select backdrop by the CSS-module class literal
// `.ui-select-backdrop`. A module class is HASHED at build time, so that literal matched
// NOTHING — clicking the backdrop (meant only to close the Select's own option list) fell
// through to "click outside the whole editor" and tore down the entire multiselect editor.
//
// Solid components can't be mounted under `bun test` here (solid-js/web resolves to its
// server build — see CLAUDE.md), so this is a source-level check in the spirit of
// cssLayering.test.ts / moduleClassCheck.ts: it reads the actual files and asserts the
// backdrop carries the `data-select-backdrop` runtime hook, and that the consumer reaches it
// through that hook rather than the hashed class.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const selectSrc = readFileSync(join(import.meta.dir, 'Select.tsx'), 'utf8')
const editorSrc = readFileSync(
    join(import.meta.dir, '../bases/PropertyValueEditor.tsx'),
    'utf8',
)

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

    it("PropertyValueEditor's outside-click guard matches the data attribute, not the hashed class", () => {
        expect(editorSrc).toContain('[data-select-backdrop]')
        // The old literal matched nothing at runtime — guard against it coming back.
        expect(editorSrc).not.toContain("'.bismuth-popover, .ui-select-backdrop'")
    })
})
