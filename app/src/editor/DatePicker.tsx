// app/src/editor/DatePicker.tsx
// The date/datetime frontmatter property popover's markup + presentation, mounted by
// datePickerExtension.tsx's `showTooltip` tooltip (see that file for why it's a tooltip and not a
// CodeMirror autocomplete source, and for the CM-view-coupled logic — value insertion,
// tooltip identity, the field's dismissal state — that has to stay imperative because it
// dispatches into the EditorView).
//
// This component owns ONLY what can be owned declaratively: the picked day and time it shows,
// and which relative-date row is highlighted. Two things it does NOT own, by design:
//   - inserting a picked value into the document (the caller does that; this component only
//     reports the intent via onDateChange/onTimeChange/onPick)
//   - keyboard navigation of the preset rows (ArrowUp/Down/Enter/Escape are CodeMirror keymap
//     commands bound to the EditorView, which never sees this component — so the caller drives
//     highlight moves through the imperative `handleRef` handle below)
//
// The day is picked on the app's own month grid (ui/MonthCalendar) and the time typed into
// ui/TimeField — never the engine's date/time controls, whose overlays ignore the theme. The
// grid picks on mousedown + preventDefault, so a pick never blurs the editor.
import { createSignal, For, Show, type Component } from 'solid-js'
import MonthCalendar from '../ui/MonthCalendar'
import TimeField from '../ui/TimeField'
import TextButton from '../ui/TextButton'
import { settings } from '../settings'
import styles from './DatePicker.module.css'

export type DatePickerKind = 'date' | 'datetime'

export type DateOption = { label: string; date: string }

/** Imperative handle for the keyboard commands in datePickerExtension.tsx, which only get the
 *  EditorView (not this component) from CodeMirror's keymap. */
export type DatePickerHandle = {
    /** Move the highlighted relative-date row by `delta`, wrapping. Returns false when there
     *  are no rows (nothing to highlight). */
    moveHighlight(delta: number): boolean
    /** Apply the currently-highlighted row, if any. Returns false when nothing is highlighted. */
    pickHighlighted(): boolean
    /** Sync the shown day and time to a value edited elsewhere in the document — but never the
     *  time while the user is typing in it, so an in-progress edit is never clobbered. */
    refresh(date: string, time: string): void
}

export type DatePickerProps = {
    kind: DatePickerKind
    initialDate: string
    initialTime: string
    options: DateOption[]
    /** A day was picked on the grid. `close` is true for a bare `date` kind (nothing else to
     *  set) and false for `datetime` (the popover stays open so the time can be set next). */
    onDateChange: (value: string, close: boolean) => void
    /** A whole time was entered — always closes the popover. */
    onTimeChange: (value: string) => void
    /** Clear the value. Given → a `[clear]` action shows under the grid while a day is picked. */
    onClear?: () => void
    /** A relative-date row was picked (click or Enter). */
    onPick: (index: number) => void
    /** Receives the imperative handle once, on mount. */
    handleRef?: (handle: DatePickerHandle) => void
}

const DatePicker: Component<DatePickerProps> = props => {
    const [date, setDate] = createSignal(props.initialDate)
    const [time, setTime] = createSignal(props.initialTime)
    const [highlight, setHighlight] = createSignal(-1)
    let timeRef: HTMLDivElement | undefined

    function clampIndex(i: number): number {
        const n = props.options.length
        if (n === 0) return -1
        if (i < 0) return n - 1
        if (i >= n) return 0
        return i
    }

    props.handleRef?.({
        moveHighlight(delta) {
            if (props.options.length === 0) return false
            setHighlight(h => clampIndex(h + delta))
            return true
        },
        pickHighlighted() {
            const i = highlight()
            if (i < 0) return false
            props.onPick(i)
            return true
        },
        refresh(d, t) {
            setDate(d)
            if (!timeRef?.contains(document.activeElement)) setTime(t)
        },
    })

    return (
        <div class={`bismuth-popover ${styles.root}`}>
            <MonthCalendar
                value={date()}
                mondayFirst={settings.calendar.weekStartsOnMonday}
                onPick={v => {
                    setDate(v)
                    props.onDateChange(v, props.kind === 'date')
                }}
            />
            <Show when={props.kind === 'datetime' || (props.onClear && date())}>
                <div class={styles.foot}>
                    <Show when={props.kind === 'datetime'}>
                        <div ref={timeRef} class={styles.time}>
                            <TimeField
                                value={time()}
                                military={settings.calendar.militaryTime}
                                suggest={false}
                                onChange={v => {
                                    setTime(v)
                                    props.onTimeChange(v)
                                }}
                            />
                        </div>
                    </Show>
                    <Show when={props.onClear && date()}>
                        <TextButton
                            variant="unselected"
                            class={styles.clear}
                            onClick={() => props.onClear?.()}
                        >
                            clear
                        </TextButton>
                    </Show>
                </div>
            </Show>
            {/* the menu family's divider (global.css .bismuth-popover-sep): the time field's
                underline already divides a datetime picker */}
            <Show when={props.kind !== 'datetime'}>
                <div class={`bismuth-popover-sep ${styles.sep}`} />
            </Show>
            <div class={styles.list}>
                <For each={props.options}>
                    {(opt, i) => (
                        <div
                            class={`bismuth-popover-row ${highlight() === i() ? 'bismuth-popover-row--selected' : ''}`}
                            onMouseDown={e => {
                                // preventDefault → applying a row never blurs the editor.
                                e.preventDefault()
                                props.onPick(i())
                            }}
                            onMouseEnter={() => setHighlight(i())}
                        >
                            {/* design-system-ignore bareElement: bismuth-popover-label/-detail
                                are the shared runtime `bismuth-*` chrome from global.css's
                                `ui/popover/popover.css` section (DESIGN.md externalClasses) —
                                wrapping in Text would style over it */}
                            <span class="bismuth-popover-label">{/* design-system-ignore bareElement: bismuth-popover-label is shared runtime chrome, DESIGN.md externalClasses */}{opt.label}</span>
                            <span class="bismuth-popover-detail">{/* design-system-ignore bareElement: bismuth-popover-detail is shared runtime chrome, DESIGN.md externalClasses */}{opt.date}</span>
                        </div>
                    )}
                </For>
            </div>
        </div>
    )
}

export default DatePicker
