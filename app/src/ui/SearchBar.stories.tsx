// Visual spec for <SearchBar> — the leading-icon input used by the command palette,
// quick switcher, and Find panels.
//
// Props: value + onInput (controlled), placeholder?, onEnter? / onKeyDown? (the
// latter wins — for list-navigating search boxes), leadingIcon? (default "Search"),
// autofocus?, children (trailing adornments — toggles/buttons rendered after the
// input), class? / inputClass? / inputStyle?.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, type JSX } from 'solid-js'
import { expect } from 'storybook/test'
import SearchBar from './SearchBar'
import Chip from './Chip'
import { settings, setSettings } from '../settings'

const meta = {
    title: 'UI/SearchBar',
    component: SearchBar,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SearchBar>

export default meta
type Story = StoryObj<typeof meta>

let confirmFires = 0

function Controlled(props: {
    initial?: string
    placeholder?: string
    leadingIcon?: string
    children?: JSX.Element
}) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '320px' }}>
            <SearchBar
                value={v()}
                onInput={setV}
                placeholder={props.placeholder}
                leadingIcon={props.leadingIcon}
            >
                {props.children}
            </SearchBar>
        </div>
    )
}

/** Empty, showing the default "Search" icon + placeholder. */
export const Placeholder: Story = {
    render: () => <Controlled placeholder="Search notes…" />,
}

/** With a typed value. */
export const Filled: Story = {
    render: () => (
        <Controlled initial="meeting notes" placeholder="Search notes…" />
    ),
}

/** A custom leading icon (e.g. the quick switcher uses a different glyph per mode). */
export const CustomLeadingIcon: Story = {
    render: () => (
        <Controlled leadingIcon="Command" placeholder="Type a command…" />
    ),
}

/** `ui-confirm` (settings.keybindings) is rebindable — proves `onEnter` fires through
 *  widgetKeys.ts's isConfirmKey rather than a hardcoded `e.key === 'Enter'` check. Once rebound
 *  away from Enter, a plain Enter press no longer fires `onEnter`, and only the new combo does. */
export const RebindableConfirmKey: Story = {
    render: () => {
        confirmFires = 0
        const [v, setV] = createSignal('')
        return (
            <div style={{ width: '320px' }}>
                <SearchBar
                    value={v()}
                    onInput={setV}
                    placeholder="Search notes…"
                    onEnter={() => confirmFires++}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector('input') as HTMLInputElement
        const saved = settings.keybindings['ui-confirm']
        try {
            setSettings('keybindings', 'ui-confirm', 'Mod+Enter')
            el.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                }),
            )
            await expect(confirmFires).toBe(0)
            el.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    metaKey: true,
                    bubbles: true,
                }),
            )
            await expect(confirmFires).toBe(1)
        } finally {
            setSettings('keybindings', 'ui-confirm', saved)
        }
    },
}

/** Trailing adornments after the input — the Find panel's match-case/whole-word/regex
 *  chip toggles. */
export const WithTrailingChips: Story = {
    render: () => {
        const [matchCase, setMatchCase] = createSignal(false)
        const [wholeWord, setWholeWord] = createSignal(true)
        return (
            <Controlled initial="TODO" placeholder="Find…">
                <Chip
                    icon="CaseSensitive"
                    selected={matchCase()}
                    onClick={() => setMatchCase(v => !v)}
                    title="Match case"
                />
                <Chip
                    icon="Check"
                    selected={wholeWord()}
                    onClick={() => setWholeWord(v => !v)}
                    title="Whole word"
                />
                <Chip icon="Regex" title="Regex" />
            </Controlled>
        )
    },
}
