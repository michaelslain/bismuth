// Structural assertion for ARIA listboxes, shared by stories whose `play` renders option rows
// (PaletteRow, SearchResultRows). Orphaned options and listboxes holding non-option children are
// both invalid ARIA and invisible to every other check — nothing failed when the Cmd+O switcher
// emitted role="option" rows under a plain div, so this is the check that would have.
import { expect } from 'storybook/test'

/** Every `[role=option]` under `root` sits inside a `[role=listbox]`, and every listbox's element
 *  children are options, or NAMED `group`s that own at least one option (ARIA 1.2: a listbox owns
 *  `option` and `group > option`; SearchResultRows wraps each file's option head + snippet lines in
 *  one group). A group with no option or no accessible name, or any other child, still fails.
 *  `min` is the least number of options the root must hold (default 1; pass 0 for an empty state,
 *  where it then only asserts that no empty listbox is left behind). */
export function assertListboxStructure(root: ParentNode, min = 1): void {
    const options = Array.from(root.querySelectorAll('[role="option"]'))
    expect(options.length).toBeGreaterThanOrEqual(min)
    for (const o of options) {
        expect(o.closest('[role="listbox"]')).not.toBeNull()
    }
    for (const box of Array.from(root.querySelectorAll('[role="listbox"]'))) {
        const kids = Array.from(box.children)
        // A listbox with no options is an empty widget, not a list.
        expect(kids.length).toBeGreaterThan(0)
        for (const k of kids) {
            const role = k.getAttribute('role')
            if (role === 'group') {
                expect(k.getAttribute('aria-label') ?? '').not.toBe('')
                expect(k.querySelector('[role="option"]')).not.toBeNull()
            } else expect(role).toBe('option')
        }
    }
}
