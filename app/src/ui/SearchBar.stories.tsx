// Visual spec for <SearchBar> — the terminal prompt-line field used by the command palette,
// quick switcher, graph Find, code find bar, and chat history search.
//
// Props: value + onInput (controlled), placeholder?, size? ('compact' | 'default' | 'large',
// default 'default'), prompt? (the leading glyph, default '/'), onEnter? / onKeyDown? (the
// latter wins — for list-navigating search boxes), autofocus?, children (trailing adornments —
// toggles/buttons rendered after the input), class? (layout only, on the root).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, Show, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor } from 'storybook/test'
import SearchBar from './SearchBar'
import Chip from './Chip'
import IconButton from './IconButton'
import Text from './Text'
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
    size?: 'compact' | 'default' | 'large'
    prompt?: string
    children?: JSX.Element
}) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '320px' }}>
            <SearchBar
                value={v()}
                onInput={setV}
                placeholder={props.placeholder}
                size={props.size}
                prompt={props.prompt}
            >
                {props.children}
            </SearchBar>
        </div>
    )
}

/** Empty, showing the default `/` prompt + placeholder. */
export const Placeholder: Story = {
    render: () => <Controlled placeholder="Search notes…" />,
}

/** With a typed value. */
export const Filled: Story = {
    render: () => (
        <Controlled initial="meeting notes" placeholder="Search notes…" />
    ),
}

/** The command palette's own prompt glyph — `>` instead of `/`. */
export const CommandPrompt: Story = {
    render: () => (
        <Controlled prompt=">" placeholder="Type a command…" />
    ),
}

/** `compact` density — panels, popovers, find bars. */
export const Compact: Story = {
    render: () => (
        <Controlled size="compact" placeholder="Find…" initial="todo" />
    ),
}

/** `large` density — the command palette and quick switcher. */
export const Large: Story = {
    render: () => (
        <Controlled size="large" placeholder="Search everything…" />
    ),
}

/** Focused, so the frame captures the accent underline + bold prompt glyph. */
export const Focused: Story = {
    render: () => <Controlled placeholder="Search notes…" />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector('input') as HTMLInputElement
        input.focus()
        await waitFor(() => expect(document.activeElement).toBe(input))
        const root = input.parentElement as HTMLElement
        const lead = root.firstElementChild as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(root).boxShadow).not.toBe('none'),
        )
        await expect(
            parseInt(getComputedStyle(lead).fontWeight, 10),
        ).toBeGreaterThanOrEqual(600)
    },
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

/** Trailing CONTROLS, not just static chips — the shape PreviewView's code find bar composes: a
 *  match count, prev/next, and close, wired through `onKeyDown` (Enter/Shift+Enter steps,
 *  Escape closes) rather than `onEnter`. Shared by both stories below so each mounts its own
 *  independent signals. */
function TrailingControlsDemo() {
    const [query, setQuery] = createSignal('')
    const [index, setIndex] = createSignal(0)
    const [closed, setClosed] = createSignal(false)
    const total = 4
    let inputEl: HTMLInputElement | undefined
    const step = (dir: 1 | -1) => setIndex(i => (i + dir + total) % total)
    return (
        <Show when={!closed()} fallback={<div data-testid="closed">closed</div>}>
            <div style={{ width: '320px' }}>
                <SearchBar
                    value={query()}
                    onInput={setQuery}
                    placeholder="Find"
                    aria-label="Find in file"
                    inputRef={el => (inputEl = el)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            step(e.shiftKey ? -1 : 1)
                        } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setClosed(true)
                        }
                    }}
                >
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        data-testid="count"
                    >
                        {query() ? `${index() + 1}/${total}` : ''}
                    </Text>
                    <IconButton
                        icon="ChevronUp"
                        label="Previous match"
                        onClick={() => {
                            step(-1)
                            inputEl?.focus()
                        }}
                    />
                    <IconButton
                        icon="ChevronDown"
                        label="Next match"
                        onClick={() => {
                            step(1)
                            inputEl?.focus()
                        }}
                    />
                    <IconButton
                        icon="X"
                        label="Close"
                        onClick={() => setClosed(true)}
                    />
                </SearchBar>
            </div>
        </Show>
    )
}

/** Proves the input's keyboard behaviour survives being wrapped in trailing controls, and that
 *  `inputRef`/`aria-label` reach the real `<input>`. Ends with a query typed and matches stepped
 *  through, so the captured frame is the open bar with its trailing controls — not Escape's
 *  closed fallback (that's its own story below). */
export const WithTrailingControls: Story = {
    render: () => <TrailingControlsDemo />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector('input') as HTMLInputElement
        await expect(input.getAttribute('aria-label')).toBe('Find in file')
        const count = () =>
            (
                canvasElement.querySelector(
                    '[data-testid="count"]',
                ) as HTMLElement
            ).textContent
        // Typing narrows the count through onInput.
        await fireEvent.input(input, { target: { value: 'todo' } })
        await waitFor(() => expect(count()).toBe('1/4'))
        // Enter steps forward through the FULL onKeyDown passthrough, not onEnter (none passed).
        await fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(count()).toBe('2/4'))
        // Shift+Enter steps backward, twice, wrapping to the last match.
        await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        await waitFor(() => expect(count()).toBe('4/4'))
    },
}

/** Escape closes the bar — split out so the primary story's frame stays the open state. */
export const WithTrailingControlsEscapeCloses: Story = {
    render: () => <TrailingControlsDemo />,
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector('input') as HTMLInputElement
        await fireEvent.keyDown(input, { key: 'Escape' })
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="closed"]'),
            ).toBeInTheDocument(),
        )
    },
}
