// Visual + behaviour spec for <CalendarChip> — the shared shell of every calendar chip (an event
// pill, a task line): a focusable role=button that opens on click / Enter / Space and asks for
// its menu on right-click / Shift+F10. Real state: the counters below are signals the play()
// reads back, never no-op callbacks.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
import CalendarChip from './CalendarChip'
import Text from '../../ui/Text'

const meta = {
    title: 'Calendar/Components/CalendarChip',
    component: CalendarChip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarChip>

export default meta
type Story = StoryObj<typeof meta>

export const OpensFromPointerAndKeyboard: Story = {
    render: () => {
        const [opened, setOpened] = createSignal(0)
        const [menu, setMenu] = createSignal('none')
        return (
            <div style={{ width: '220px' }}>
                <CalendarChip
                    label="Design review"
                    onOpen={() => setOpened(n => n + 1)}
                    onMenu={(x, y) => setMenu(`${Math.round(x)},${Math.round(y)}`)}
                    data-testid="chip"
                >
                    <Text as="span" inherit>
                        Design review
                    </Text>
                </CalendarChip>
                <Text as="p" size="micro" tone="muted" data-testid="opened">
                    {opened()}
                </Text>
                <Text as="p" size="micro" tone="muted" data-testid="menu">
                    {menu()}
                </Text>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const chip = c.getByRole('button', { name: 'Design review' })
        expect(chip.tabIndex).toBe(0)
        await userEvent.click(chip)
        expect(c.getByTestId('opened').textContent).toBe('1')
        chip.focus()
        await userEvent.keyboard('{Enter}')
        expect(c.getByTestId('opened').textContent).toBe('2')
        await userEvent.keyboard(' ')
        expect(c.getByTestId('opened').textContent).toBe('3')
        await userEvent.keyboard('{Shift>}{F10}{/Shift}')
        expect(c.getByTestId('menu').textContent).not.toBe('none')
        expect(getComputedStyle(chip).outlineStyle === 'none' || getComputedStyle(chip).outlineWidth === '0px').toBe(true)
    },
}

export const RightClickAsksForTheMenu: Story = {
    render: () => {
        const [menu, setMenu] = createSignal('none')
        return (
            <div style={{ width: '220px' }}>
                <CalendarChip label="Standup" onOpen={() => {}} onMenu={(x, y) => setMenu(`${x},${y}`)}>
                    <Text as="span" inherit>
                        Standup
                    </Text>
                </CalendarChip>
                <Text as="p" size="micro" tone="muted" data-testid="menu">
                    {menu()}
                </Text>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await fireEvent.contextMenu(c.getByRole('button', { name: 'Standup' }), { clientX: 12, clientY: 34 })
        expect(c.getByTestId('menu').textContent).toBe('12,34')
    },
}
