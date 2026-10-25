// Visual spec for <ButtonRow> — one ```button fence as bracket chips (primary last) and a single
// status or confirm line under them. Every story pins `now` so the "2m ago" readouts are stable.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn } from 'storybook/test'
import type {
    ButtonBlock,
    ButtonState,
} from '../../../core/src/buttons/buttonTypes'
import ButtonRow from './ButtonRow'
import type { ButtonRowProps } from './ButtonRow'
import { buttonRuntime, setButtonRuntime } from './buttonRuntime'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (secs: number) => new Date(NOW - secs * 1000).toISOString()

const PROMPT = 'Summarize what changed in this note this week and append it under ## Week.'
const block: ButtonBlock = {
    error: null,
    buttons: [
        {
            label: 'Summarize this week',
            kind: 'primary',
            action: { type: 'prompt', prompt: PROMPT, model: 'sonnet', timeoutSecs: 300 },
        },
        { label: 'Open daemon', kind: 'default', action: { type: 'command', id: 'open-daemon' } },
        {
            label: 'Ask about it',
            kind: 'default',
            action: { type: 'send', text: 'What are the open questions in this note?' },
        },
        {
            label: 'Clear week',
            kind: 'danger',
            action: { type: 'prompt', prompt: 'Delete the ## Week section.', model: 'haiku', timeoutSecs: 120 },
        },
    ],
}

const st = (over: Partial<ButtonState>): ButtonState => ({
    status: 'done',
    host: 'note:week.md',
    label: 'summarize this week',
    prompt: PROMPT,
    model: 'sonnet',
    timeoutSecs: 300,
    pressedAt: ago(125),
    completedAt: ago(120),
    note: 'Added a four-line summary under ## Week.',
    ...over,
})

const noop = () => {}
const base: ButtonRowProps = {
    block,
    states: [null, null, null, null],
    confirming: null,
    daemonOff: false,
    notOwner: false,
    now: NOW,
    onPress: noop,
    onConfirm: noop,
    onCancel: noop,
}

const old = buttonRuntime()
setButtonRuntime({ ...old, commandLabel: id => (id === 'open-daemon' ? 'Open daemon' : undefined) })

const meta = {
    title: 'App/Buttons/ButtonRow',
    component: ButtonRow,
    parameters: { layout: 'fullscreen' },
    render: args => (
        <div style={{ width: 'min(760px, 100%)', padding: '16px' }}>
            <ButtonRow {...args} />
        </div>
    ),
} satisfies Meta<typeof ButtonRow>

export default meta
type Story = StoryObj<typeof meta>

const chips = (el: HTMLElement) => [...el.querySelectorAll('button')]
const text = (el: HTMLElement) => el.textContent || ''

/** Source order with the primary moved last; the danger chip in the danger tone. */
export const Idle: Story = {
    args: base,
    play: async ({ canvasElement }) => {
        await expect(chips(canvasElement).map(b => b.textContent)).toEqual([
            'open daemon',
            'ask about it',
            'clear week',
            'summarize this week',
        ])
    },
}

/** Each chip carries a data-tooltip: the prompt, `send: …`, the command label. */
export const Tooltips: Story = {
    args: base,
    play: async ({ canvasElement }) => {
        const tips = chips(canvasElement).map(b => b.getAttribute('data-tooltip'))
        await expect(tips).toEqual([
            'Open daemon',
            'send: What are the open questions in this note?',
            'Delete the ## Week section.',
            PROMPT,
        ])
    },
}

export const Working: Story = {
    args: {
        ...base,
        states: [st({ status: 'working', completedAt: null, note: null, pressedAt: ago(8) }), null, null, null],
    },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain('working…')
        const b = chips(canvasElement)
        await expect(b[3].disabled).toBe(true)
        await expect(b[0].disabled).toBe(false)
    },
}

export const Done: Story = {
    args: { ...base, states: [st({}), null, null, null] },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain(
            'done // Added a four-line summary under ## Week. // 2m ago',
        )
        await expect(chips(canvasElement)[3].disabled).toBe(false)
    },
}

export const DoneLongNote: Story = {
    args: {
        ...base,
        states: [
            st({
                note: `${'Rewrote every heading in the note so that they follow the sentence-case rule. '.repeat(3)}\nsecond line`,
            }),
            null,
            null,
            null,
        ],
    },
}

export const Failed: Story = {
    args: {
        ...base,
        states: [st({ status: 'failed', note: 'the note changed while the job ran' }), null, null, null],
    },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain(
            'failed // the note changed while the job ran // 2m ago',
        )
        await expect(chips(canvasElement)[3].disabled).toBe(false)
    },
}

export const StaleWorking: Story = {
    args: {
        ...base,
        states: [
            st({ status: 'working', completedAt: null, note: null, pressedAt: ago(300 + 60 + 120) }),
            null,
            null,
            null,
        ],
    },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain('failed // no response from the daemon // 8m ago')
        await expect(chips(canvasElement)[3].disabled).toBe(false)
    },
}

export const ConfirmPrompt: Story = {
    args: { ...base, confirming: 0, onConfirm: fn(), onCancel: fn() },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain(`run this?${PROMPT}`)
        await expect(text(canvasElement)).toContain('sonnet // 300s')
        await expect(chips(canvasElement).slice(-2).map(b => b.textContent)).toEqual(['run', 'cancel'])
    },
}

export const ConfirmSend: Story = {
    args: { ...base, confirming: 2 },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain('send this?What are the open questions in this note?')
        await expect(chips(canvasElement).slice(-2).map(b => b.textContent)).toEqual(['send', 'cancel'])
    },
}

const LONG = Array.from(
    { length: 11 },
    (_, i) => `Step ${i + 1}: review the section and tidy the wording of every bullet under it.`,
)
    .concat('Finally append the word ZEBRAFINISH.')
    .join('\n')

/** A long prompt shows whole in a box that scrolls past six lines; model and timeout under it. */
export const ConfirmLongPrompt: Story = {
    args: {
        ...base,
        block: {
            error: null,
            buttons: [
                {
                    label: 'Tidy note',
                    kind: 'primary',
                    action: { type: 'prompt', prompt: LONG, model: 'haiku', timeoutSecs: 300 },
                },
            ],
        },
        states: [null],
        confirming: 0,
    },
    play: async ({ canvasElement }) => {
        const box = canvasElement.querySelector<HTMLElement>('[data-confirm-text]')!
        await expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
        await expect(text(canvasElement)).toContain('ZEBRAFINISH.')
        await expect(text(canvasElement)).toContain('haiku // 300s')
    },
}

/** Prompt chips disabled; send and command stay live. */
export const DaemonOff: Story = {
    args: { ...base, daemonOff: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain('daemon is off')
        const b = chips(canvasElement)
        await expect(b.map(x => x.disabled)).toEqual([false, false, true, true])
    },
}

export const NotOwner: Story = {
    args: { ...base, notOwner: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain(
            "this device isn't the daemon owner — pressing here won't run",
        )
        const b = chips(canvasElement)
        await expect(b.map(x => x.disabled)).toEqual([false, false, true, true])
    },
}

export const Invalid: Story = {
    args: { ...base, block: { buttons: [], error: 'needs exactly one of prompt, send, command' } },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toContain('button // needs exactly one of prompt, send, command')
        await expect(chips(canvasElement).length).toBe(0)
    },
}
