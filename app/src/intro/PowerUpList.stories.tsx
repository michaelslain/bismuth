// Visual spec for <PowerUpList> — the intro's power-ups slide body: a Card per optional power-up,
// each a ToggleRow (icon + name + [x]/[ ] switch) over its wrapping description.
//
// Props: items, selected (ids), onToggle(id), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import PowerUpList from './PowerUpList'

const ITEMS = [
    {
        id: 'daemon',
        icon: 'Bot',
        name: 'daemon',
        desc: "A background agent that runs crons and weaves memory while you're away.",
    },
    {
        id: 'cli',
        icon: 'SquareTerminal',
        name: 'cli + mcp',
        desc: 'Drive your vault from the shell, and let your coding agent read the docs + write bases.',
    },
]

const meta = {
    title: 'Intro/PowerUpList',
    component: PowerUpList,
    parameters: { layout: 'centered' },
    args: { items: ITEMS, selected: ['daemon', 'cli'], onToggle: () => {} },
} satisfies Meta<typeof PowerUpList>

export default meta
type Story = StoryObj<typeof meta>

/** Both power-ups selected — how the slide opens. */
export const BothOn: Story = {}

/** One card alone, centred at one card's width (the pick-an-agent slide with nothing installed). */
export const Single: Story = {
    args: {
        items: [
            {
                id: 'free-agent',
                icon: 'Download',
                name: 'free agent',
                desc: 'Runs opencode on free models. No account, about 45 MB. Free models may keep your prompts.',
            },
        ],
        selected: ['free-agent'],
    },
}

const AGENTS = [
    {
        id: 'claude',
        icon: 'SquareTerminal',
        name: 'claude code',
        desc: 'Installed on this machine.',
    },
    {
        id: 'codex',
        icon: 'SquareTerminal',
        name: 'openai codex',
        desc: 'Installed on this machine.',
    },
    {
        id: 'free-agent',
        icon: 'Download',
        name: 'free agent',
        desc: 'Runs opencode on free models. No account, about 45 MB. Free models may keep your prompts.',
    },
]

/** `single`: exactly one card selected; clicking another moves the selection. */
export const SingleSelect: Story = {
    render: () => {
        const [picked, setPicked] = createSignal('claude')
        return (
            <PowerUpList
                single
                items={AGENTS}
                selected={[picked()]}
                onToggle={setPicked}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const rows = () =>
            Array.from(
                canvasElement.querySelectorAll<HTMLElement>(
                    '[data-testid="toggle-row"]',
                ),
            )
        const checked = () => rows().map(r => r.getAttribute('aria-checked'))
        expect(checked()).toEqual(['true', 'false', 'false'])
        rows()[2].click()
        await new Promise(r => setTimeout(r, 0))
        expect(checked()).toEqual(['false', 'false', 'true'])
        rows()[2].click()
        await new Promise(r => setTimeout(r, 0))
        expect(checked()).toEqual(['false', 'false', 'true'])
    },
}

/** One selected, one off: the `[x]` / `[ ]` pair side by side. */
export const OneOff: Story = { args: { selected: ['daemon'] } }

/** Local state: Space on a focused row flips it. */
export const Interactive: Story = {
    render: () => {
        const [selected, setSelected] = createSignal(['daemon', 'cli'])
        return (
            <PowerUpList
                items={ITEMS}
                selected={selected()}
                onToggle={id =>
                    setSelected(s =>
                        s.includes(id) ? s.filter(x => x !== id) : [...s, id],
                    )
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(
            '[data-testid="toggle-row"]',
        )!
        expect(row.getAttribute('aria-checked')).toBe('true')
        row.focus()
        row.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        )
        await new Promise(r => setTimeout(r, 0))
        expect(row.getAttribute('aria-checked')).toBe('false')
    },
}

/** A narrow window: the art box is ~90 cells wide, so the two cards must wrap or shrink inside it. */
export const Narrow: Story = {
    decorators: [
        Story => (
            <div style={{ width: 'calc(90 * var(--cell-w))' }}>
                <Story />
            </div>
        ),
    ],
}
