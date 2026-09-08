// Visual spec for <ModalHeader> — the header strip six modals used to hand-roll (icon mark +
// title + optional subtitle + a close control), extracted onto calendar/Calendar.module.css's
// `.evm-head` family. See ModalHeader.tsx's header comment for the full story.
//
// Props: icon (registry name, required), title (required), subtitle (optional), onClose
// (required), compact (centres the mark against a single-line title), tone ('danger' paints the
// mark --danger), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { ModalHeader } from './ModalHeader'

const meta = {
    title: 'UI/ModalHeader',
    component: ModalHeader,
    parameters: { layout: 'padded' },
    args: {
        icon: 'Calendar',
        title: 'New Event',
        onClose: () => {},
    },
} satisfies Meta<typeof ModalHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Icon + title + subtitle — EventModal's shape, two-line, `align-items: flex-start`. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '440px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader
                icon="Calendar"
                title="New Event"
                subtitle="Tuesday, August 12"
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector('[class*="modal-title"]')
        const sub = canvasElement.querySelector('[class*="modal-sub"]')
        expect(title).not.toBeNull()
        expect(title!.textContent).toBe('New Event')
        expect(sub).not.toBeNull()
        expect(sub!.textContent).toBe('Tuesday, August 12')
        expect(canvasElement.querySelector('svg')).not.toBeNull()
    },
}

/** No subtitle — CategoryPanel / CalendarSettings' shape: the mark centres against a
 *  single-line title instead of sitting at the top of a two-line block. */
export const Compact: Story = {
    render: () => (
        <div style={{ width: '440px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader icon="Tag" title="Categories" compact onClose={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector('[class*="modal-title"]')
        expect(title).not.toBeNull()
        expect(title!.textContent).toBe('Categories')
        // No subtitle passed -> the <Show> renders nothing, not an empty node.
        expect(canvasElement.querySelector('[class*="modal-sub"]')).toBeNull()
        const head = canvasElement.querySelector(
            '[class*="modal-head"]',
        ) as HTMLElement
        expect(head.className).toMatch(/compact/)
    },
}

/** The defect this component exists to prevent recurring: `bases/BaseSettings.tsx` used a
 *  `<div role="button">` with no `tabindex` for its close control, which is NOT reachable by
 *  keyboard at all. Here the close control is a real IconButton — a `<button>` element, present
 *  in the standard focusable-element query the same way `ui/Modal.tsx`'s own focus trap builds
 *  its list (tag selectors only, never a class name — see CLAUDE.md's DOM-interrogation rule). */
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const CloseIsFocusable: Story = {
    render: () => (
        <div style={{ width: '440px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader
                icon="Settings2"
                title="Calendar settings"
                compact
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const close = canvasElement.querySelector('button[aria-label="Close"]')
        expect(close).not.toBeNull()
        expect(close!.tagName).toBe('BUTTON')
        const focusable = [
            ...canvasElement.querySelectorAll(FOCUSABLE),
        ]
        expect(focusable).toContain(close)
    },
}

/** Destructive tone — RecurrenceDialog's delete shape. The mark alone changes hue; the title,
 *  subtitle and close control stay neutral. `play` asserts the two marks actually compute to
 *  different colours rather than merely carrying different class names, since a `tone` prop that
 *  silently failed to reach the CSS would still render a perfectly plausible header. */
export const DangerTone: Story = {
    render: () => (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '12px',
                width: '440px',
            }}
        >
            <ModalHeader
                icon="trash-2"
                title="Delete recurring event"
                subtitle="MATH 128A Lecture"
                compact
                onClose={() => {}}
            />
            <ModalHeader
                icon="trash-2"
                title="Delete recurring event"
                subtitle="MATH 128A Lecture"
                compact
                tone="danger"
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const marks = [
            ...canvasElement.querySelectorAll('[class*="modal-mark"]'),
        ] as HTMLElement[]
        expect(marks.length).toBe(2)
        const plain = getComputedStyle(marks[0]!).color
        const danger = getComputedStyle(marks[1]!).color
        expect(danger).not.toBe(plain)
        // The title beside a danger mark must NOT also turn red — the tone is on the mark only.
        const titles = [
            ...canvasElement.querySelectorAll('[class*="modal-title"]'),
        ] as HTMLElement[]
        expect(getComputedStyle(titles[1]!).color).toBe(
            getComputedStyle(titles[0]!).color,
        )
    },
}
