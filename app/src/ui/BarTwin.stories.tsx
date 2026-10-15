// Visual spec for <BarTwin> — a bar command drawn as a worded half and a bare-icon half, one of
// which is laid out at any width. The tier widths live in ViewBar.module.css (`early`, `late`;
// both measured against the bar's CONTENT box, so a 24px-padded pane is 24px wider than the
// threshold) and in ChatControls.module.css (`row`, 280px against the chat row).
//
// Each frame stacks the three shapes a twin takes — a one-shot command, a toggle that is on, a
// toggle that is off — and its play asserts that for EVERY one exactly one half is displayed, which
// is the whole contract: no width where both show, none where neither does. A toggle's bare half
// also reports its state (`aria-pressed`), because brackets mean ON.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import type { JSX } from 'solid-js'
import BarTwin, { type BarTwinProps } from './BarTwin'
import ViewBar from './ViewBar'
import ChatControls from '../chat/ChatControls'
import { makeStubChatSession } from '../chat/_stubChatSession'

const meta = {
    title: 'UI/BarTwin',
    component: BarTwin,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BarTwin>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

type Drop = BarTwinProps['drop']

/** The three shapes, in one place so every frame differs only in width and tier. */
const Shapes = (props: { drop: Drop }): JSX.Element => (
    <>
        <BarTwin
            drop={props.drop}
            icon="Plus"
            label="add"
            data-testid="one-shot"
            onClick={noop}
        />
        <BarTwin
            drop={props.drop}
            icon="Zap"
            label="cram"
            active
            data-testid="toggle-on"
            onClick={noop}
        />
        <BarTwin
            drop={props.drop}
            icon="Tag"
            label="tags"
            active={false}
            data-testid="toggle-off"
            onClick={noop}
        />
    </>
)

/** A view bar `width` px wide holding the three shapes. */
const InBar = (props: { width: number; drop: 'early' | 'late' }) => (
    <div style={{ width: `${props.width}px`, 'max-width': 'none' }}>
        <ViewBar config={<Shapes drop={props.drop} />} />
    </div>
)

const laidOut = (el: Element | null) =>
    !!el && (el as HTMLElement).getClientRects().length > 0

/** Every twin in the frame shows exactly one half, and it is `want`. */
const expectHalf = (root: HTMLElement, want: 'full' | 'icon') => {
    const twins = [...root.querySelectorAll<HTMLElement>('[data-bar-twin]')]
    expect(twins.length).toBeGreaterThanOrEqual(3)
    for (const twin of twins) {
        const halves = [
            ...twin.querySelectorAll<HTMLElement>('[data-bar-twin-half]'),
        ]
        expect(halves.length).toBe(2)
        const shown = halves.filter(laidOut)
        expect(shown.length).toBe(1)
        expect(shown[0]!.getAttribute('data-bar-twin-half')).toBe(want)
    }
}

/** Toggle state: the bare half reports it (`aria-pressed`) — on is pressed, off is not. The worded
 *  half carries the state in its look, not in an attribute. A one-shot never has one. */
const expectPressed = (root: HTMLElement) => {
    const shownOf = (id: string) =>
        [
            ...root.querySelectorAll<HTMLElement>(
                `[data-testid="${id}"], [data-testid="${id}-icon"]`,
            ),
        ].find(laidOut)!
    const icon = (el: HTMLElement) =>
        el.getAttribute('data-bar-twin-half') === 'icon'
    const on = shownOf('toggle-on')
    const off = shownOf('toggle-off')
    if (icon(on)) expect(on.getAttribute('aria-pressed')).toBe('true')
    if (icon(off)) expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(shownOf('one-shot').hasAttribute('aria-pressed')).toBe(false)
}

const frame = (
    width: number,
    drop: 'early' | 'late',
    want: 'full' | 'icon',
): Story => ({
    render: () => <InBar {...{ width, drop }} />,
    play: async ({ canvasElement }) => {
        expectHalf(canvasElement, want)
        expectPressed(canvasElement)
    },
})

/** early tier, 900px pane = 876px content box, above 800: worded. */
export const EarlyAbove: Story = frame(900, 'early', 'full')
/** early tier, 700px pane: under 800, bare. */
export const EarlyBelow: Story = frame(700, 'early', 'icon')
/** late tier, 600px pane = 576px content box, above 480: worded. */
export const LateAbove: Story = frame(600, 'late', 'full')
/** late tier, a 480-wide pane = 456 content box, under the tier: bare. */
export const LateBelow: Story = frame(480, 'late', 'icon')

const SESSION = () =>
    makeStubChatSession({
        manifest: {
            model: 'claude-opus-4-8',
            permissionMode: 'bypassPermissions',
            slashCommands: ['compact', 'clear'],
            tools: ['Read', 'Write', 'Bash'],
            mcpServers: [{ name: 'bismuth', status: 'connected' }],
        },
        models: [
            {
                value: 'opus',
                label: 'Opus 4.8',
                description: 'Most capable',
                effortLevels: ['low', 'medium', 'high'],
            },
        ],
        displayModel: 'opus',
        displayModelValue: 'opus',
        permMode: 'bypassPermissions',
        effortOptions: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
        ],
        effortValue: 'medium',
    })

/** `row` is swapped by the chat row's own container tier, so these frames are the real row: history
 *  (a toggle, closed) and new chat (a one-shot). 400px is above 280 — worded. */
export const RowAbove: Story = {
    render: () => (
        <div style={{ width: '400px' }}>
            <ChatControls session={SESSION()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const twins = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-bar-twin="row"]',
            ),
        ]
        expect(twins.length).toBe(2)
        for (const twin of twins) {
            const shown = [
                ...twin.querySelectorAll<HTMLElement>('[data-bar-twin-half]'),
            ].filter(laidOut)
            expect(shown.length).toBe(1)
            expect(shown[0]!.getAttribute('data-bar-twin-half')).toBe('full')
        }
    },
}

/** 240px is under 280: bare, and the closed history toggle is not pressed. */
export const RowBelow: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <ChatControls session={SESSION()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const twins = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-bar-twin="row"]',
            ),
        ]
        expect(twins.length).toBe(2)
        for (const twin of twins) {
            const shown = [
                ...twin.querySelectorAll<HTMLElement>('[data-bar-twin-half]'),
            ].filter(laidOut)
            expect(shown.length).toBe(1)
            expect(shown[0]!.getAttribute('data-bar-twin-half')).toBe('icon')
        }
        const history = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-history-icon"]',
        )!
        expect(history.getAttribute('aria-pressed')).toBe('false')
    },
}
