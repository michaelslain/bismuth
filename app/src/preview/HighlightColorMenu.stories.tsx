// app/src/preview/HighlightColorMenu.stories.tsx
// Visual + behavioural spec for <HighlightColorMenu> — the PDF highlight button's right-click
// colour menu. Opened from the bar it is checked by PreviewBar's own stories; these pin it alone.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor } from 'storybook/test'
import HighlightColorMenu from './HighlightColorMenu'
import Text from '../ui/Text'

const meta = {
    title: 'Preview/HighlightColorMenu',
    component: HighlightColorMenu,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HighlightColorMenu>

export default meta
type Story = StoryObj<typeof meta>

function Live() {
    const [c, setC] = createSignal('hl')
    const [open, setOpen] = createSignal(true)
    return (
        <div style={{ height: '220px', padding: '8px' }}>
            <Text data-testid="picked">{c()}</Text>
            <Show when={open()}>
                <HighlightColorMenu
                    x={24}
                    y={40}
                    value={c()}
                    onPick={setC}
                    onClose={() => setOpen(false)}
                />
            </Show>
        </div>
    )
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.bismuth-popover-row'))

/** Open: five rows, a small swatch before each name, yellow marked current. */
export const Open: Story = {
    render: () => <Live />,
    play: async () => {
        await waitFor(() => expect(rows()).toHaveLength(5))
        await expect(rows().map(r => r.textContent?.replace('current', '').trim())).toEqual([
            'yellow',
            'green',
            'blue',
            'pink',
            'orange',
        ])
        await expect(rows()[0]!.textContent).toContain('current')
        const sw = rows()[4]!.querySelector('.bismuth-popover-prefix > *') as HTMLElement
        await expect(getComputedStyle(sw).backgroundColor).toBe('rgb(255, 169, 77)')
    },
}

/** A pick hands back the colour and closes the menu. */
export const Pick: Story = {
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(rows()).toHaveLength(5))
        await fireEvent.click(rows()[3]!)
        await waitFor(() => expect(rows()).toHaveLength(0))
        await expect(
            canvasElement.querySelector('[data-testid="picked"]')!.textContent,
        ).toBe('#F783AC')
    },
}
