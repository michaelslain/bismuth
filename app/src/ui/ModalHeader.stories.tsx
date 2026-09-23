// Visual spec for <ModalHeader> — the top-rule row every modal draws: a title, an optional
// `// subtitle`, and a close control, with the rule itself drawn as line segments either side of
// that text (see ModalHeader.tsx's header comment for the anatomy). `icon`/`compact` are
// deprecated no-ops (Task 12 deletes both).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { ModalHeader } from './ModalHeader'

const meta = {
    title: 'UI/ModalHeader',
    component: ModalHeader,
    parameters: { layout: 'padded' },
    args: {
        title: 'new event',
        onClose: () => {},
    },
} satisfies Meta<typeof ModalHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Title only — the acceptance shape: one hairline broken only by the title text and `[x]`,
 *  meeting the panel's own left/right border with no stub above and no second line below. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '440px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader title="new event" onClose={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector('[class*="title"]')
        expect(title).not.toBeNull()
        expect(title!.textContent).toBe('new event')
        expect(canvasElement.querySelector('[class*="sep"]')).toBeNull()
        const close = canvasElement.querySelector('button[aria-label="Close"]')
        expect(close).not.toBeNull()
        expect(close).toHaveAttribute('data-modal-close')
    },
}

/** `// subtitle` — the separator is the app-wide `//` glyph, never a middot. */
export const WithSubtitle: Story = {
    render: () => (
        <div style={{ width: '440px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader
                title="new event"
                subtitle="tuesday, august 12"
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const sep = canvasElement.querySelector('[class*="sep"]')
        expect(sep).not.toBeNull()
        expect(sep!.textContent).toBe('//')
        const sub = canvasElement.querySelector('[class*="sub"]')
        expect(sub).not.toBeNull()
        expect(sub!.textContent).toBe('tuesday, august 12')
    },
}

/** Destructive tone — RecurrenceDialog's delete shape. `tone="danger"` paints the title
 *  --danger; the subtitle and close control stay neutral, same as before. */
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
                title="delete recurring event"
                subtitle="math 128a lecture"
                onClose={() => {}}
            />
            <ModalHeader
                title="delete recurring event"
                subtitle="math 128a lecture"
                tone="danger"
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const titles = [
            ...canvasElement.querySelectorAll('[class*="title"]'),
        ] as HTMLElement[]
        expect(titles.length).toBe(2)
        const plain = getComputedStyle(titles[0]!).color
        const danger = getComputedStyle(titles[1]!).color
        expect(danger).not.toBe(plain)
        // The subtitle beside a danger title must NOT also turn red — the tone is on the title only.
        const subs = [
            ...canvasElement.querySelectorAll('[class*="sub"]'),
        ] as HTMLElement[]
        expect(getComputedStyle(subs[1]!).color).toBe(
            getComputedStyle(subs[0]!).color,
        )
    },
}

/** A title far too long for the row ellipsizes before reaching the close control — it never
 *  pushes `[x]` outside the panel or wraps onto a second line. */
export const LongTitleEllipsis: Story = {
    render: () => (
        <div style={{ width: '320px', border: '1px solid var(--border-soft)' }}>
            <ModalHeader
                title="a considerably longer modal title than this narrow panel can ever hope to show in full"
                onClose={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector(
            '[class*="title"]',
        ) as HTMLElement
        expect(title).not.toBeNull()
        expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
        const close = canvasElement.querySelector(
            'button[aria-label="Close"]',
        ) as HTMLElement
        const panel = canvasElement.firstElementChild as HTMLElement
        // The close control stays fully inside the panel — the title ellipsized instead of
        // pushing it out or wrapping the row onto a second line.
        expect(close.getBoundingClientRect().right).toBeLessThanOrEqual(
            panel.getBoundingClientRect().right + 1,
        )
    },
}
