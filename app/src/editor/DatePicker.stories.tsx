// Visual spec for <DatePicker> — the date/datetime frontmatter property popover mounted by
// datePickerExtension.tsx's CodeMirror `showTooltip` tooltip. This story renders the popover
// content in isolation (a fixed-position `.cm-tooltip` shell stands in for CodeMirror's own,
// so the `.bismuth-datepicker`-style background override still applies) — it does not exercise
// the CodeMirror mount path itself, only the DOM this component draws inside it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import DatePicker from './DatePicker'

const OPTIONS = [
    { label: 'Today', date: '2026-09-20' },
    { label: 'Tomorrow', date: '2026-09-21' },
    { label: 'In a week', date: '2026-09-27' },
]

const noop = () => {}
// What DateAndTime's picker reported, read by its play.
const dates: [string, boolean][] = []
const times: string[] = []

const meta = {
    title: 'Editor/DatePicker',
    component: DatePicker,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

/** A bare `date` property: the month grid over the relative-date list, no time row. */
export const DateOnly: Story = {
    render: () => (
        <div class="cm-editor">
            <div class="cm-tooltip">
                <DatePicker
                    kind="date"
                    initialDate="2026-09-20"
                    initialTime=""
                    options={OPTIONS}
                    onDateChange={noop}
                    onTimeChange={noop}
                    onPick={noop}
                />
            </div>
        </div>
    ),
}

/** A `datetime` property: the grid, then the typed time, then the presets.
 *
 *  The play is the guard on "never the engine's controls": no native date or time input is
 *  drawn, nothing calls `HTMLInputElement.prototype.showPicker`, a day pressed on the grid
 *  reports the date WITHOUT closing (the time comes next), and a typed time reports on the
 *  confirm key. */
export const DateAndTime: Story = {
    play: async ({ canvasElement }) => {
        dates.length = 0
        times.length = 0
        await expect(
            canvasElement.querySelector('input[type="date"], input[type="time"]'),
        ).toBeNull()
        const proto: { showPicker?: () => void } = HTMLInputElement.prototype
        const had = Object.prototype.hasOwnProperty.call(proto, 'showPicker')
        const original = proto.showPicker
        let calls = 0
        proto.showPicker = () => {
            calls += 1
        }
        try {
            const day = canvasElement.querySelector<HTMLElement>('[data-iso="2026-09-22"]')!
            await userEvent.pointer({ keys: '[MouseLeft>]', target: day })
            await waitFor(() => expect(dates).toEqual([['2026-09-22', false]]))
            const time = canvasElement.querySelector<HTMLInputElement>('[data-time-field] input')!
            await expect(time.value).toBe('2:30 pm')
            await userEvent.clear(time)
            await userEvent.type(time, '9:15a{Enter}')
            await waitFor(() => expect(times).toEqual(['09:15']))
        } finally {
            if (had) proto.showPicker = original
            else delete proto.showPicker
        }
        expect(calls, 'nothing may open the engine overlay').toBe(0)
    },
    render: () => (
        <div class="cm-editor">
            <div class="cm-tooltip">
                <DatePicker
                    kind="datetime"
                    initialDate="2026-09-20"
                    initialTime="14:30"
                    options={OPTIONS}
                    onDateChange={(v, close) => dates.push([v, close])}
                    onTimeChange={v => times.push(v)}
                    onPick={noop}
                />
            </div>
        </div>
    ),
}

/** A base field's picker (`onClear` given) with a day set: `[clear]` sits under the grid. */
export const WithClear: Story = {
    render: () => (
        <div class="cm-editor">
            <div class="cm-tooltip">
                <DatePicker
                    kind="date"
                    initialDate="2026-09-20"
                    initialTime=""
                    options={OPTIONS}
                    onDateChange={noop}
                    onTimeChange={noop}
                    onClear={noop}
                    onPick={noop}
                />
            </div>
        </div>
    ),
}
