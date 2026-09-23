// Visual spec for <Select> — a custom dropdown replacing the native <select>.
//
// The trigger reuses the `.ui-input` chrome (matches TextInput) with a trailing
// chevron; the open list is the shared <PopoverList> surface (same chrome as the
// context menu + autocomplete), portaled to <body> and keyboard-navigable. The
// current value shows a Check in the open list.
//
// Select is controlled (value + onChange). To SEE the open dropdown, click the
// trigger — the popover renders portaled over the page.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, type JSX } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import Select, { type SelectOption } from './Select'
import { Label } from './_storyKit'

const meta = {
    title: 'UI/Select',
    component: Select,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

const THEME_OPTIONS: SelectOption[] = [
    { value: 'ink', label: 'Ink' },
    { value: 'paper', label: 'Paper' },
    { value: 'cathode', label: 'Cathode' },
    { value: 'riso', label: 'Riso' },
]

function Controlled(props: {
    options: SelectOption[]
    initial?: string
    placeholder?: string
}) {
    const [value, setValue] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '260px' }}>
            <Select
                value={value()}
                options={props.options}
                onChange={setValue}
                placeholder={props.placeholder}
            />
        </div>
    )
}

function Field(props: { label: string; children: JSX.Element }) {
    return (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}
        >
            <Label>{props.label}</Label>
            {props.children}
        </div>
    )
}

/** A value selected — the trigger shows the chosen label + chevron. */
export const Default: Story = {
    render: () => <Controlled options={THEME_OPTIONS} initial="ink" />,
}

/** No value → the muted placeholder is shown instead of a label. */
export const Placeholder: Story = {
    render: () => (
        <Controlled options={THEME_OPTIONS} placeholder="Choose a theme…" />
    ),
}

/** Falls back to the built-in "Select…" when neither value nor placeholder is set. */
export const EmptyDefault: Story = {
    render: () => <Controlled options={THEME_OPTIONS} />,
}

/** The trigger sits near the bottom of the viewport — the open list must flip UP so it never
 *  renders off-screen. This is the actual answer to the "menus open downward off the window"
 *  complaint; no other Select story ever opens its menu, so without this the wiring behind
 *  `openMenu()`/`reposition()`'s fit test has no rendered proof anywhere. */
export const OpenNearBottomEdge: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => (
        <div
            style={{
                position: 'fixed',
                top: `${window.innerHeight - 40}px`,
                left: '120px',
                width: '260px',
            }}
        >
            <Controlled options={THEME_OPTIONS} initial="ink" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        await expect(trigger).not.toBeNull()
        trigger.click()
        const popover = await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const popRect = popover.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        // Flipped ABOVE the trigger, not clamped over it.
        await expect(popRect.bottom).toBeLessThanOrEqual(triggerRect.top)
    },
}

/** The trigger sits at the top of the viewport — the conditional half of the fit test: a list
 *  that fits below must stay below, so a future "just always flip up" regression fails here. */
export const OpenNearTopEdge: Story = {
    parameters: { layout: 'fullscreen' },
    render: () => (
        <div
            style={{
                position: 'fixed',
                top: '8px',
                left: '120px',
                width: '260px',
            }}
        >
            <Controlled options={THEME_OPTIONS} initial="ink" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        await expect(trigger).not.toBeNull()
        trigger.click()
        const popover = await waitFor(() => {
            const el = document.querySelector('.bismuth-popover') as HTMLElement | null
            if (!el) throw new Error('popover did not open')
            return el
        })
        const popRect = popover.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        await expect(popRect.top).toBeGreaterThanOrEqual(triggerRect.bottom)
    },
}

/** Keyboard focus on the trigger — proves the non-accent focus cue (bold value text + bold
 *  caret, both in --fg) fires on :focus-visible, since the rule-firming alone is near-invisible. */
export const Focused: Story = {
    render: () => <Controlled options={THEME_OPTIONS} initial="ink" />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        await expect(trigger).not.toBeNull()
        trigger.focus()
        await expect(trigger).toHaveFocus()
    },
}

/** Both states side by side. Click a trigger to open the portaled list. */
export const Gallery: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '20px' }}
        >
            <Field label="with value">
                <Controlled options={THEME_OPTIONS} initial="paper" />
            </Field>
            <Field label="placeholder">
                <Controlled
                    options={THEME_OPTIONS}
                    placeholder="Choose a theme…"
                />
            </Field>
        </div>
    ),
}
