// Visual spec for <Chip> — a selectable pill (the canonical toggle button).
//
// Props: selected (on/off), tone (tints the SELECTED state), icon (+ iconSize), title,
// children. Used for export Format/Page-size/Theme options and Search match-case/
// whole-word/regex toggles.
//
// `tone` accepts 7 values: `accent` (default) plus the six category tones
// (teal/blue/violet/green/gold/rose), each with its own distinct selected
// look — 14% fill / 45% border of that tone's color. The Tones story shows all seven.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, For } from 'solid-js'
import Chip, { type ChipTone } from './Chip'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Chip',
    component: Chip,
    parameters: { layout: 'centered' },
    argTypes: {
        tone: {
            control: 'inline-radio',
            options: [
                'accent',
                'teal',
                'blue',
                'violet',
                'green',
                'gold',
                'rose',
            ],
        },
        selected: { control: 'boolean' },
        icon: { control: 'text' },
        children: { control: 'text' },
    },
    args: {
        tone: 'accent',
        selected: false,
        children: 'Chip',
    },
} satisfies Meta<typeof Chip>

export default meta
type Story = StoryObj<typeof meta>

const ALL_TONES: ChipTone[] = [
    'accent',
    'teal',
    'blue',
    'violet',
    'green',
    'gold',
    'rose',
]

/** Fully controllable single chip. */
export const Playground: Story = {}

/** Unselected vs selected (default accent tone). */
export const States: Story = {
    render: () => (
        <Row label="accent · off / on" gap="10px">
            <Chip>Unselected</Chip>
            <Chip selected>Selected</Chip>
        </Row>
    ),
}

/** Chip with a leading icon, and an icon-only chip. */
export const WithIcon: Story = {
    render: () => (
        <Row label="with icon" gap="10px">
            <Chip icon="Search">Match case</Chip>
            <Chip icon="Check" selected>
                Whole word
            </Chip>
            <Chip icon="Regex" title="Regex" />
        </Row>
    ),
}

/** Every tone, unselected then selected — each tone gets its own distinct selected look. */
export const Tones: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}
        >
            <Row label="unselected" gap="10px">
                <For each={ALL_TONES}>
                    {tone => <Chip tone={tone}>{tone}</Chip>}
                </For>
            </Row>
            <Row label="selected" gap="10px">
                <For each={ALL_TONES}>
                    {tone => (
                        <Chip tone={tone} selected>
                            {tone}
                        </Chip>
                    )}
                </For>
            </Row>
        </div>
    ),
}

/** Interactive toggle — click to flip selected. */
export const Interactive: Story = {
    render: () => {
        const [on, setOn] = createSignal(false)
        return (
            <Chip
                icon="CaseSensitive"
                tone="teal"
                selected={on()}
                onClick={() => setOn(v => !v)}
            >
                Aa
            </Chip>
        )
    },
}
