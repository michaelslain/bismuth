// Visual spec for <ModalFooter> — the action strip six modals used to hand-roll (an optional
// `esc` hint, optional leading actions, a spacer, trailing actions), extracted onto
// calendar/Calendar.module.css's `.evm-foot` family. See ModalFooter.tsx's header comment.
//
// Props: hint (optional, words after the `esc` key cap), leading (left-aligned actions before
// the spacer), children (right-aligned trailing actions), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { ModalFooter } from './ModalFooter'
import { TextButton } from './TextButton'

const meta = {
    title: 'UI/ModalFooter',
    component: ModalFooter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ModalFooter>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '440px', border: '1px solid var(--border-soft)' }

/** CategoryPanel's shape: an `esc` hint, no leading actions, one trailing action. */
export const HintAndActions: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter hint="to close">
                <TextButton size="sm" variant="selected" data-testid="mf-done">
                    DONE
                </TextButton>
            </ModalFooter>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const hint = canvasElement.querySelector('[class*="modal-hint"]')
        expect(hint).not.toBeNull()
        expect(hint!.textContent).toBe('esc to close')
        const done = canvasElement.querySelector('[data-testid="mf-done"]')
        expect(done).not.toBeNull()
        expect(done!.textContent).toBe('DONE')
    },
}

/** CalendarSettings' shape: hint, a leading RESET, and trailing CANCEL/SAVE. `play` asserts the
 *  DOM order the primitive promises — hint, then leading, then the spacer, then trailing —
 *  since that order is what makes `leading` land at the LEFT and `children` at the RIGHT of the
 *  spacer's `flex: 1`. */
export const LeadingAndTrailing: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter
                hint="to close"
                leading={
                    <TextButton size="sm" data-testid="mf-reset">
                        RESET
                    </TextButton>
                }
            >
                <TextButton size="sm" data-testid="mf-cancel">
                    CANCEL
                </TextButton>
                <TextButton size="sm" variant="selected" data-testid="mf-save">
                    SAVE
                </TextButton>
            </ModalFooter>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const foot = canvasElement.querySelector(
            '[class*="modal-foot"]',
        ) as HTMLElement
        expect(foot).not.toBeNull()
        const kids = [...foot.children] as HTMLElement[]
        // hint (span carrying the <b>esc</b>), leading wrapper, spacer, then the two trailing
        // buttons — a flat DOM order check catches a slot ever landing in the wrong place.
        const order = kids.map(k => {
            if (k.querySelector('b')) return 'hint'
            if (k.querySelector('[data-testid="mf-reset"]')) return 'leading'
            if (k.matches('[class*="modal-foot-sp"]')) return 'spacer'
            return k.getAttribute('data-testid') ?? k.tagName
        })
        expect(order).toEqual(['hint', 'leading', 'spacer', 'mf-cancel', 'mf-save'])
    },
}

/** EventModal's shape: NO hint, and DELETE/DUPLICATE lead. This is the case ModalFooter.tsx's
 *  comment warns about: the leading slot must sit FLUSH against the footer's own left padding
 *  when nothing precedes it, not carry the extra margin it gets when a hint sits before it (see
 *  ModalFooter.module.css's `:not(:first-child)` rule). `play` asserts the leading action's left
 *  edge lands within a couple pixels of the footer's own padding box — not offset by the margin
 *  that only applies when a hint is present. */
export const NoHint: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter
                leading={
                    <TextButton size="sm" danger data-testid="mf-delete">
                        DELETE
                    </TextButton>
                }
            >
                <TextButton size="sm" variant="selected" data-testid="mf-save">
                    CREATE EVENT
                </TextButton>
            </ModalFooter>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const foot = canvasElement.querySelector(
            '[class*="modal-foot"]',
        ) as HTMLElement
        const leading = canvasElement.querySelector(
            '[data-testid="mf-delete"]',
        ) as HTMLElement
        expect(foot).not.toBeNull()
        expect(leading).not.toBeNull()
        const footStyle = getComputedStyle(foot)
        const footLeft = foot.getBoundingClientRect().left
        const paddingLeft = parseFloat(footStyle.paddingLeft)
        const leadingLeft = leading.getBoundingClientRect().left
        expect(Math.abs(leadingLeft - (footLeft + paddingLeft))).toBeLessThan(3)
    },
}
