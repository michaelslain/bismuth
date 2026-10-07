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
    disabled?: boolean
    label?: string
}) {
    const [value, setValue] = createSignal(props.initial ?? '')
    return (
        <div style={{ width: '260px' }}>
            <Select
                value={value()}
                options={props.options}
                onChange={setValue}
                placeholder={props.placeholder}
                disabled={props.disabled}
                label={props.label}
            />
        </div>
    )
}

const inkOf = (host: HTMLElement, token: string) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${token})`
    host.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
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

/** `disabled` reaches the trigger: it is a disabled <button>, reads `--faint` (never opacity), has no
 *  pointer cursor, and a click does not open the list. */
export const Disabled: Story = {
    render: () => <Controlled options={THEME_OPTIONS} initial="ink" disabled />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        await expect(trigger.disabled).toBe(true)
        const cs = getComputedStyle(trigger)
        await expect(cs.color).toBe(inkOf(canvasElement, '--faint'))
        await expect(cs.opacity).toBe('1')
        await expect(cs.cursor).toBe('default')
        trigger.click()
        await expect(document.querySelector('.bismuth-popover')).toBeNull()
    },
}

/** `label` is the trigger's accessible name where no visible caption names it (FilterConditionRow's
 *  three selects had NO name): it lands as `aria-label` on the button. */
export const Labelled: Story = {
    render: () => (
        <Controlled options={THEME_OPTIONS} initial="ink" label="theme" />
    ),
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        await expect(trigger.getAttribute('aria-label')).toBe('theme')
        await expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    },
}

/** An empty value reads as a PLACEHOLDER — `--text-muted`, never full ink — whether it is the
 *  placeholder text or an option carrying the empty value (a "(clear)" row, which used to render in
 *  full ink and read as a chosen value). A chosen value stays `--fg`. */
export const EmptyReadsMuted: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
            <Controlled options={THEME_OPTIONS} placeholder="Choose a theme…" />
            <Controlled
                options={[{ value: '', label: '(clear)' }, ...THEME_OPTIONS]}
                initial=""
            />
            <Controlled options={THEME_OPTIONS} initial="ink" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const values = [...canvasElement.querySelectorAll('button > span:first-child')]
        const muted = inkOf(canvasElement, '--text-muted')
        await expect(getComputedStyle(values[0]).color).toBe(muted)
        await expect(values[1].textContent).toBe('(clear)')
        await expect(getComputedStyle(values[1]).color).toBe(muted)
        await expect(getComputedStyle(values[2]).color).not.toBe(muted)
    },
}

/** Opened, EVERY row's label starts at one x: the chosen row's Check cell is reserved on the others
 *  too (the chosen row's label used to start ~13px right of its siblings). */
export const OptionLabelsAlign: Story = {
    render: () => <Controlled options={THEME_OPTIONS} initial="paper" />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector('button') as HTMLButtonElement
        trigger.click()
        const labels = await waitFor(() => {
            const els = [...document.querySelectorAll('.bismuth-popover-label')]
            if (els.length !== THEME_OPTIONS.length) throw new Error('not open')
            return els
        })
        const lefts = labels.map(l => Math.round(l.getBoundingClientRect().left))
        await expect(new Set(lefts).size).toBe(1)
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
