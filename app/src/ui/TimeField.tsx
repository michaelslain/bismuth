// app/src/ui/TimeField.tsx
// A time of day as typed text, in place of the engine's clock control: "2:30 pm" (or "14:30"
// under the 24-hour setting), with the day's half-hour slots suggested under it, opening on the
// time already set. It stores `HH:MM` either way.
//
// It commits only a WHOLE time, and only when the person is done with it — a picked slot, the
// confirm key, or focus leaving — never per keystroke, so "2" on the way to "2:30 pm" never lands
// as 02:00 in a host that acts on every change (the editor's date tooltip closes on a time).
// Text that is not a time when focus leaves snaps back to the stored value.
//
// `suggest={false}` drops the slot list for a host that is itself a floating surface (the date
// popover), where a second popover would stack on the first.
import { createEffect, createMemo, createSignal, on, Show, type Component } from 'solid-js'
import SuggestInput, { type SuggestOption } from './SuggestInput'
import TextInput from './TextInput'
import { isConfirmKey } from './widgetKeys'
import { formatTimeText, parseTimeText, timeSlots } from './timeFieldText'
import styles from './TimeField.module.css'

export type TimeFieldProps = {
    /** Stored `HH:MM` (24h); empty for none. */
    value: string
    onChange: (hhmm: string) => void
    /** Show 24-hour labels (the calendar's `militaryTime` setting). Default 12-hour. */
    military?: boolean
    /** Suggest the day's half-hour slots under the field. Default true. */
    suggest?: boolean
    placeholder?: string
    class?: string
}

const TimeField: Component<TimeFieldProps> = props => {
    const label = (hhmm: string) => formatTimeText(hhmm, !!props.military)
    const [text, setText] = createSignal(label(props.value))

    // A value changed from outside replaces the text; one this field just committed already matches.
    createEffect(
        on(
            () => [props.value, props.military] as const,
            () => {
                if (parseTimeText(text()) !== props.value) setText(label(props.value))
            },
            { defer: true },
        ),
    )

    // Over the time already set, the next few slots from it; once the person types, every slot,
    // narrowed by what they typed. Never all 48 at once, which would cover the host.
    const NEARBY = 8
    const options = createMemo<SuggestOption[]>(() => {
        const slots = timeSlots(props.value).map(s => ({ value: label(s) }))
        return text() === label(props.value) ? slots.slice(0, NEARBY) : slots
    })

    function commit(raw: string): void {
        const t = parseTimeText(raw)
        if (t === null) {
            setText(label(props.value))
            return
        }
        setText(label(t))
        if (t !== props.value) props.onChange(t)
    }

    function onInput(v: string): void {
        setText(v)
        // A slot picked from the list arrives as its exact label: that is a finished choice.
        if (timeSlots('').some(s => label(s) === v)) commit(v)
    }

    return (
        <div
            class={[styles.root, props.class].filter(Boolean).join(' ')}
            data-time-field
            onKeyDown={e => {
                if (isConfirmKey(e)) commit(text())
            }}
            onFocusOut={e => {
                const to = e.relatedTarget as Node | null
                if (!to || !e.currentTarget.contains(to)) commit(text())
            }}
        >
            <Show
                when={props.suggest ?? true}
                fallback={
                    <TextInput
                        value={text()}
                        onInput={setText}
                        placeholder={props.placeholder ?? label('09:00')}
                        inputmode="text"
                        autocomplete="off"
                    />
                }
            >
                <SuggestInput
                    value={text()}
                    options={options()}
                    onInput={onInput}
                    placeholder={props.placeholder ?? label('09:00')}
                    // Over a time already set (the field just focused), show the nearby slots;
                    // once the person types, narrow to the slots that start with what they typed.
                    filter={(o, q) =>
                        q === label(props.value) ||
                        o.value.startsWith(q.trim().toLowerCase())
                    }
                />
            </Show>
        </div>
    )
}

export default TimeField
