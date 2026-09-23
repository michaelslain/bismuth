// Visual spec for <ModalFooter> — the action strip every modal ends in (optional leading actions,
// a spacer, trailing actions). No keybind hint: every modal ends in a real dismiss button. See
// ModalFooter.tsx's header comment.
//
// Props: leading (left-aligned actions before the spacer), children (right-aligned trailing
// actions), class.
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

/** CategoryPanel's shape: no leading actions, one trailing action — and no `esc` keybind text. */
export const TrailingOnly: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter>
                <TextButton variant="selected" data-testid="mf-done">
                    done
                </TextButton>
            </ModalFooter>
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).not.toContain('esc')
        const done = canvasElement.querySelector('[data-testid="mf-done"]')
        expect(done).not.toBeNull()
        expect(done!.textContent).toBe('done')
    },
}

/** CalendarSettings' shape: a leading reset, and trailing cancel/save. `play` asserts the
 *  DOM order the primitive promises — leading, then the spacer, then trailing —
 *  since that order is what makes `leading` land at the LEFT and `children` at the RIGHT of the
 *  spacer's `flex: 1`. */
export const LeadingAndTrailing: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter
                leading={
                    <TextButton data-testid="mf-reset">
                        reset
                    </TextButton>
                }
            >
                <TextButton data-testid="mf-cancel">
                    cancel
                </TextButton>
                <TextButton variant="selected" data-testid="mf-save">
                    save
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
        // leading wrapper, spacer, then the two trailing buttons — a flat DOM order check catches
        // a slot ever landing in the wrong place.
        const order = kids.map(k => {
            if (k.querySelector('[data-testid="mf-reset"]')) return 'leading'
            if (k.matches('[class*="modal-foot-sp"]')) return 'spacer'
            return k.getAttribute('data-testid') ?? k.tagName
        })
        expect(order).toEqual(['leading', 'spacer', 'mf-cancel', 'mf-save'])
    },
}

/** EventModal's shape: delete/duplicate lead. The leading slot must sit FLUSH against the
 *  footer's own left padding — `play` asserts the leading action's left edge lands within a
 *  couple pixels of the footer's padding box. */
export const LeadingFlush: Story = {
    render: () => (
        <div style={shell}>
            <ModalFooter
                leading={
                    <TextButton danger data-testid="mf-delete">
                        delete
                    </TextButton>
                }
            >
                <TextButton variant="selected" data-testid="mf-save">
                    create event
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
