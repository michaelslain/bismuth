// Visual spec for <HeatCell> — one heatmap square. Interactive in the grid (a real button: Tab
// reaches it, Enter/Space activate it, focus and hover both report), a plain-text swatch in the
// legend. The interaction stories hold real state so a no-op callback never passes for a click.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import HeatCell from './HeatCell'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/HeatCell',
    component: HeatCell,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof HeatCell>

export default meta
type Story = StoryObj<typeof meta>

const GLYPH = ['.', '-', '+', '#']

/** The four tiers side by side, as the grid draws them: faint, muted, accent, accent. */
export const Tiers: Story = {
    args: { level: 0, glyph: '.' },
    render: () => (
        <div style={{ display: 'flex' }}>
            {GLYPH.map((glyph, level) => (
                <HeatCell date={`2026-07-0${level + 1}`} level={level} glyph={glyph} label={`tier ${level}`} />
            ))}
        </div>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('button').length).toBe(4))
    },
}

/** The selected square is drawn in `--fg` whatever its tier (here the top one), next to an
 *  unselected one. */
export const Selected: Story = {
    args: { level: 3, glyph: '#' },
    render: () => (
        <div style={{ display: 'flex' }}>
            <HeatCell date="2026-07-01" level={3} glyph="#" label="unselected" selected={false} />
            <HeatCell date="2026-07-02" level={3} glyph="#" label="selected" selected />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [a, b] = Array.from(canvasElement.querySelectorAll('button'))
        expect(a.getAttribute('aria-pressed')).toBe('false')
        expect(b.getAttribute('aria-pressed')).toBe('true')
        expect(getComputedStyle(b).color).not.toBe(getComputedStyle(a).color)
    },
}

/** Real state: a click, Enter and Space each activate it (the count prints), a right-click
 *  reports through `onContextMenu`, and hover and focus both flip the `hovered` line. */
export const Interactive: Story = {
    args: { level: 2, glyph: '+' },
    render: () => {
        const [activated, setActivated] = createSignal(0)
        const [menus, setMenus] = createSignal(0)
        const [hovered, setHovered] = createSignal(false)
        return (
            <div>
                <HeatCell
                    date="2026-07-08"
                    level={2}
                    glyph="+"
                    label="Tue Jul 8: 5"
                    onHover={setHovered}
                    onClick={() => setActivated(n => n + 1)}
                    onContextMenu={e => {
                        e.preventDefault()
                        setMenus(n => n + 1)
                    }}
                />
                <Text as="p" size="ui" tone="muted">
                    activated: {activated()} // menus: {menus()} // hovered: {String(hovered())}
                </Text>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('[data-bucket="2026-07-08"]')
            if (!el) throw new Error('cell not mounted yet')
            return el
        })
        expect(cell.getAttribute('aria-label')).toBe('Tue Jul 8: 5')
        await userEvent.click(cell)
        await waitFor(() => expect(canvasElement.textContent).toContain('activated: 1'))
        await userEvent.keyboard('{Enter}')
        await waitFor(() => expect(canvasElement.textContent).toContain('activated: 2'))
        await userEvent.keyboard(' ')
        await waitFor(() => expect(canvasElement.textContent).toContain('activated: 3'))
        await userEvent.pointer({ keys: '[MouseRight]', target: cell })
        await waitFor(() => expect(canvasElement.textContent).toContain('menus: 1'))
        cell.blur()
        await waitFor(() => expect(canvasElement.textContent).toContain('hovered: false'))
        cell.focus()
        await waitFor(() => expect(canvasElement.textContent).toContain('hovered: true'))
    },
}

/** The legend swatch: `static` renders plain text in the same tier colour — no button, so it is
 *  not a tab stop. */
export const StaticSwatch: Story = {
    args: { level: 2, glyph: '+', static: true },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('+'))
        expect(canvasElement.querySelector('button')).toBeNull()
    },
}
