// Visual spec for <DaemonPanel> — the shared frame a daemon-page panel (crons, services, inbox,
// log) can compose: an optional plain title + count over a scrolling body, with a head row that
// appears only when it has a title or actions. No border box, no eyebrow — the ViewBar facet is
// the panel's heading now.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import DaemonPanel from './DaemonPanel'
import { TextButton } from '../ui/TextButton'
import EmptyState from '../ui/EmptyState'

const meta = {
    title: 'Daemon/DaemonPanel',
    component: DaemonPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonPanel>

export default meta
type Story = StoryObj<typeof meta>

/** DaemonPanel has no data-testid hooks of its own, so these plays reach its CSS-Modules classes
 *  by substring — the same pattern ChatView.stories.tsx's TagTypography uses for `.chat-bubble`:
 *  Vite's scoping keeps the source class name as a prefix of the hashed local, so `[class*="…"]`
 *  still finds the right element without hardcoding the hash. */
const byModuleClass = (root: HTMLElement, name: string) =>
    root.querySelector<HTMLElement>(`[class*="${name}"]`)

/** A populated panel with a plain title + count — DaemonPanel's own title/count support, kept for
 *  API coverage even though no real caller passes them any more (every daemon-page panel now uses
 *  the ViewBar facet as its heading, and passes `actions` alone). A handful of rows filling the
 *  scrolling body. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '280px', height: '220px' }}>
            <DaemonPanel title="services" count={4}>
                <div style={{ padding: '4px 12px' }}>
                    {Array.from({ length: 4 }, (_, i) => (
                        <div style={{ padding: '4px 0' }}>service-{i + 1}</div>
                    ))}
                </div>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('services')).toBeInTheDocument()
        const count = byModuleClass(canvasElement, 'daemon-panel-count')
        await expect(count?.textContent).toBe('4')
        const rows = [...canvasElement.querySelectorAll('div')].filter(el =>
            /^service-\d$/.test(el.textContent?.trim() ?? ''),
        )
        await expect(rows.length).toBe(4)
    },
}

/** No title, no actions, no count — the shape DaemonInbox/DaemonLog use now that the ViewBar
 *  facet is their heading. No head row renders at all; the body sits flush at the top. */
export const WithoutTitle: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel>
                <div style={{ padding: '4px 12px' }}>plain row</div>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(byModuleClass(canvasElement, 'daemon-panel-head')).toBeNull()
        await expect(canvas.getByText('plain row')).toBeInTheDocument()
    },
}

/** No title — actions alone are enough to earn a head row, right-aligned (mirrors the inbox's
 *  "approve all" and the crons/services panels' "new cron"/"new service"). */
export const WithActions: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel actions={<TextButton>approve all</TextButton>}>
                <div style={{ padding: '4px 12px' }}>two pages waiting</div>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = canvas.getByRole('button', { name: 'approve all' })
        await expect(button).toBeInTheDocument()
        // Hidden at rest — opacity, so the button stays a real tab stop even while invisible.
        const actions = byModuleClass(canvasElement, 'daemon-panel-actions')!
        await expect(getComputedStyle(actions).opacity).toBe('0')
        button.focus()
        await waitFor(() => expect(getComputedStyle(actions).opacity).toBe('1'))
        // The head row exists because of `actions` alone — there is no title here.
        const head = byModuleClass(canvasElement, 'daemon-panel-head')
        await expect(head?.contains(button)).toBe(true)
        await expect(byModuleClass(canvasElement, 'daemon-panel-title')).toBeNull()
    },
}

/** A title with no count — the badge is omitted entirely, and the body holds an EmptyState. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel title="log">
                <EmptyState>nothing logged yet</EmptyState>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(byModuleClass(canvasElement, 'daemon-panel-count')).toBeNull()
        await expect(canvas.getByText('nothing logged yet')).toBeInTheDocument()
    },
}

/** The body overflows its fixed height — proves the panel itself stays put (height unchanged,
 *  no border to speak of) while only the body scrolls. */
export const OverflowingBody: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel title="log" count={40}>
                <div style={{ padding: '4px 12px' }}>
                    {Array.from({ length: 40 }, (_, i) => (
                        <div style={{ padding: '4px 0' }}>row {i + 1}</div>
                    ))}
                </div>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        // The story's own wrapper div is what fixes the panel's cell height (160px, per DaemonPanel's
        // job of filling its parent's height, not growing it) — the panel itself stays that height.
        const outer = canvasElement.firstElementChild as HTMLElement
        await expect(Math.round(outer.getBoundingClientRect().height)).toBe(160)
        const body = byModuleClass(canvasElement, 'daemon-panel-body')!
        await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    },
}
