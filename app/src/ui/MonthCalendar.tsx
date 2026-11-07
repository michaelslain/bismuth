// app/src/ui/MonthCalendar.tsx
// A month of days to pick one from: `‹ august 2026 ›`, the weekday heads, and the whole-week grid.
// The app's own calendar, drawn in the bracket idiom — the picked day reads `[20]` in the accent,
// the way a selected ChipToggle reads — in place of the engine's date overlay.
//
// Days are grid cells, not buttons (the WAI-ARIA date grid): one roving tab stop, the arrows move
// it a day or a week, PageUp/PageDown a month, the confirm/activate key picks. A press picks on
// `mousedown` with preventDefault, so a host that must keep focus elsewhere (the editor's date
// tooltip, whose CodeMirror view owns the caret) never loses it to a click on a day.
import { createEffect, createMemo, createSignal, For, on, type Component } from 'solid-js'
import { todayISO } from '../../../core/src/dates'
import IconButton from './IconButton'
import Text from './Text'
import { isActivateKey, isConfirmKey } from './widgetKeys'
import {
    calendarCells,
    monthLabel,
    monthOf,
    moveFocus,
    shiftMonth,
    weekdayHeads,
    type MonthRef,
} from './monthCalendarModel'
import styles from './MonthCalendar.module.css'

export type MonthCalendarProps = {
    /** The picked day, ISO `YYYY-MM-DD`; empty for none. The shown month follows it. */
    value: string
    onPick: (iso: string) => void
    /** Start weeks on Monday (the calendar's `weekStartsOnMonday` setting). Default Sunday. */
    mondayFirst?: boolean
    /** Today, ISO. Defaults to the real date; stories pin it so a frame is reproducible. */
    today?: string
    class?: string
}

const MonthCalendar: Component<MonthCalendarProps> = props => {
    const today = () => props.today ?? todayISO()
    const [focused, setFocused] = createSignal(props.value || today())
    const [view, setView] = createSignal<MonthRef>(monthOf(props.value, today()))
    let gridRef: HTMLDivElement | undefined

    // A value set from outside (a preset row, the document) brings its month into view.
    createEffect(
        on(
            () => props.value,
            v => {
                if (!v) return
                setFocused(v)
                setView(monthOf(v, today()))
            },
            { defer: true },
        ),
    )

    const cells = createMemo(() => calendarCells(view(), !!props.mondayFirst))
    const heads = createMemo(() => weekdayHeads(!!props.mondayFirst))
    // The roving tab stop: the focused day when it is on screen, else the month's first day.
    const tabStop = createMemo(() => {
        const c = cells()
        return c.some(x => x.iso === focused()) ? focused() : c.find(x => x.inMonth)!.iso
    })

    function step(delta: number): void {
        const next = shiftMonth(view(), delta)
        setView(next)
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (isConfirmKey(e) || isActivateKey(e)) {
            e.preventDefault()
            e.stopPropagation()
            props.onPick(tabStop())
            return
        }
        const next = moveFocus(tabStop(), e.key)
        if (!next) return
        e.preventDefault()
        e.stopPropagation()
        setFocused(next)
        setView(monthOf(next, today()))
        queueMicrotask(() =>
            gridRef?.querySelector<HTMLElement>(`[data-iso="${next}"]`)?.focus(),
        )
    }

    return (
        <div class={[styles.root, props.class].filter(Boolean).join(' ')} data-month-calendar>
            <div class={styles.head}>
                <IconButton
                    icon="ChevronLeft"
                    label="previous month"
                    onClick={() => step(-1)}
                />
                <Text as="span" inherit class={styles.month} aria-live="polite">
                    {monthLabel(view())}
                </Text>
                <IconButton icon="ChevronRight" label="next month" onClick={() => step(1)} />
            </div>
            <div class={styles.weekdays} aria-hidden="true">
                <For each={heads()}>
                    {h => (
                        <Text as="span" inherit class={styles.weekday}>
                            {h}
                        </Text>
                    )}
                </For>
            </div>
            <div
                ref={gridRef}
                role="grid"
                aria-label={monthLabel(view())}
                class={styles.grid}
                onKeyDown={onKeyDown}
            >
                <For each={cells()}>
                    {cell => (
                        <div
                            role="gridcell"
                            data-iso={cell.iso}
                            tabIndex={cell.iso === tabStop() ? 0 : -1}
                            aria-selected={cell.iso === props.value}
                            aria-current={cell.iso === today() ? 'date' : undefined}
                            classList={{
                                [styles.day]: true,
                                [styles.outside]: !cell.inMonth,
                                [styles.today]: cell.iso === today(),
                                [styles.selected]: cell.iso === props.value,
                            }}
                            onMouseDown={e => {
                                e.preventDefault()
                                setFocused(cell.iso)
                                props.onPick(cell.iso)
                            }}
                        >
                            <Text as="span" inherit class={styles.num}>
                                {cell.day}
                            </Text>
                        </div>
                    )}
                </For>
            </div>
        </div>
    )
}

export default MonthCalendar
