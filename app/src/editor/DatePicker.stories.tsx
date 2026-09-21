// Visual spec for <DatePicker> — the date/datetime frontmatter property popover mounted by
// datePickerExtension.tsx's CodeMirror `showTooltip` tooltip. This story renders the popover
// content in isolation (a fixed-position `.cm-tooltip` shell stands in for CodeMirror's own,
// so the `.bismuth-datepicker`-style background override still applies) — it does not exercise
// the CodeMirror mount path itself, only the DOM this component draws inside it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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

/** A `datetime` property: the date input gains a paired time input alongside it. */
export const DateAndTime: Story = {
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
