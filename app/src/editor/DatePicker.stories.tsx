// Visual spec for <DatePicker> — the date/datetime frontmatter property popover mounted by
// datePickerExtension.tsx's CodeMirror `showTooltip` tooltip. This story renders the popover
// content in isolation (a fixed-position `.cm-tooltip` shell stands in for CodeMirror's own,
// so the `.bismuth-datepicker`-style background override still applies) — it does not exercise
// the CodeMirror mount path itself, only the DOM this component draws inside it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import DatePicker from './DatePicker'

const OPTIONS = [
    { label: 'Today', date: '2026-09-20' },
    { label: 'Tomorrow', date: '2026-09-21' },
    { label: 'In a week', date: '2026-09-27' },
]

const noop = () => {}

const meta = {
    title: 'Editor/DatePicker',
    component: DatePicker,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

/** A bare `date` property: no time input, just the date field over the relative-date list. */
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

/** A `datetime` property: the date input gains a paired time input alongside it.
 *
 *  The engine's own calendar/clock indicator stays, and it is the ONLY thing that opens the native
 *  overlay. The play is the guard on that: it replaces `HTMLInputElement.prototype.showPicker`
 *  with a spy, clicks a date segment and a time segment, and asserts the spy was NEVER called —
 *  so reintroducing a click-anywhere `showPicker()` fails here. A click on a segment is how the
 *  caret gets into that segment to be typed into; popping a native overlay on it changes what the
 *  control does, and `showPicker` is unverified in the shipped WKWebView where the `try/catch`
 *  around it swallows the failure, leaving no opener at all.
 *
 *  It also asserts the fields do NOT claim a pointer cursor — they are typed into, so the caret
 *  is the honest one, and `cursor: pointer` was the cue that advertised the click-to-open. The
 *  indicator's own `display` is deliberately not asserted: it is a UA shadow pseudo-element, and
 *  Chrome's `getComputedStyle(input, '::-webkit-calendar-picker-indicator')` reports the HOST's
 *  `display` rather than the author rule, so reading it grades nothing. The frame is the proof
 *  that the glyph is drawn. */
export const DateAndTime: Story = {
    play: async ({ canvasElement }) => {
        const fields = [
            ...canvasElement.querySelectorAll<HTMLInputElement>('input'),
        ]
        expect(fields.length).toBe(2)

        const proto: { showPicker?: () => void } =
            HTMLInputElement.prototype
        const had = Object.prototype.hasOwnProperty.call(proto, 'showPicker')
        const original = proto.showPicker
        let calls = 0
        proto.showPicker = () => {
            calls += 1
        }
        try {
            for (const f of fields) {
                expect(getComputedStyle(f).cursor).not.toBe('pointer')
                await userEvent.click(f)
            }
        } finally {
            if (had) proto.showPicker = original
            else delete proto.showPicker
        }
        expect(
            calls,
            'clicking a date/time segment must not pop the native overlay — the OS indicator glyph is the only opener',
        ).toBe(0)
    },
    render: () => (
        <div class="cm-editor">
            <div class="cm-tooltip">
                <DatePicker
                    kind="datetime"
                    initialDate="2026-09-20"
                    initialTime="14:30"
                    options={OPTIONS}
                    onDateChange={noop}
                    onTimeChange={noop}
                    onPick={noop}
                />
            </div>
        </div>
    ),
}
