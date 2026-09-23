// Visual spec for <DaemonPanel> — the shared frame every daemon-page panel (crons, services,
// inbox, log) composes: eyebrow title + count + optional actions over a scrolling body.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
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

/** A populated panel: title + count, a handful of plain rows filling the scrolling body. */
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

/** A trailing actions slot beside the title (a bulk action, mirroring the inbox's "APPROVE
 *  ALL"). */
export const WithActions: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel
                title="needs review"
                count={2}
                actions={<TextButton>approve all</TextButton>}
            >
                <div style={{ padding: '4px 12px' }}>two pages waiting</div>
            </DaemonPanel>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = canvas.getByRole('button', { name: 'approve all' })
        await expect(button).toBeInTheDocument()
        // Beside the title: rendered inside the panel's head, not its scrolling body.
        const head = byModuleClass(canvasElement, 'daemon-panel-head')
        await expect(head?.contains(button)).toBe(true)
    },
}

/** No count passed — the badge is omitted entirely, and the body holds an EmptyState. */
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

/** The body overflows its fixed height — proves the panel itself stays put (border/height
 *  unchanged) while only the body scrolls. */
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
