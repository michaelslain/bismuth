// app/src/bases/DateFieldEditor.tsx
// A date property as ONE input-height control: a FormControl trigger (the same `.ui-input`
// chrome TextInput/Select use) showing the value or a muted placeholder, which opens the app's
// DatePicker (editor/DatePicker.tsx) anchored under the trigger by `<AnchoredPopover>`.
//
// Why not ui/Popover: Popover is only the floating SURFACE (border + --lift), with no anchoring,
// and DatePicker already paints that surface itself (`.bismuth-popover`) — wrapping it would
// draw two frames. So this owns only the anchor + dismiss layer, same as ui/Select.tsx.
import { Show, createSignal, onMount, type Component } from 'solid-js'
import AnchoredPopover from '../ui/AnchoredPopover'
import DatePicker, { type DatePickerKind } from '../editor/DatePicker'
import { parseDateValue, composeDateValue } from '../editor/datePickerCore'
import FormControl from '../ui/FormControl'
import Text from '../ui/Text'
import { Icon } from '../icons/Icon'
import { dateFieldPresets } from './dateFieldPresets'
import { formatDateValue } from './valueDisplay'
import styles from './DateFieldEditor.module.css'

export type DateFieldEditorProps = {
    /** `true` stores `YYYY-MM-DDTHH:MM`, else a bare `YYYY-MM-DD`. */
    time?: boolean
    value: unknown
    onCommit: (value: unknown) => void
    placeholder?: string
    className?: string
    /** Fired when the popover closes WITHOUT a pick (Escape or a click away), so a host that
     *  mounted this as a transient cell editor can end its edit. */
    onDismiss?: () => void
    /** Open the picker as soon as this mounts — for a transient cell editor, whose trigger would
     *  otherwise sit closed and never fire `onDismiss` on a click away. */
    openOnMount?: boolean
}

const DateFieldEditor: Component<DateFieldEditorProps> = props => {
    const [open, setOpen] = createSignal(false)
    const [triggerWidth, setTriggerWidth] = createSignal(0)
    let triggerRef: HTMLButtonElement | undefined
    let lastDate = ''
    let lastTime = ''
    // Set by a press on the trigger while open (which closes it); the click that follows the
    // press must not reopen it.
    let pressClosed = false
    const options = dateFieldPresets()

    const kind = (): DatePickerKind => (props.time ? 'datetime' : 'date')
    const parsed = () => parseDateValue(String(props.value ?? ''))
    const label = () => {
        const p = parsed()
        if (!p.date) return props.placeholder ?? 'Set date…'
        return formatDateValue(props.value, kind() === 'datetime')
    }

    function openPicker(): void {
        if (triggerRef) setTriggerWidth(triggerRef.getBoundingClientRect().width)
        lastDate = parsed().date
        lastTime = parsed().time
        setOpen(true)
    }
    function close(): void {
        setOpen(false)
        triggerRef?.focus()
    }
    function commit(d: string, t: string, closeAfter: boolean): void {
        props.onCommit(composeDateValue(kind(), d, t) || null)
        if (closeAfter) close()
    }

    onMount(() => {
        if (props.openOnMount) openPicker()
    })

    return (
        <>
            <FormControl
                as="button"
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open()}
                data-testid="date-field-trigger"
                class={`${styles.trigger}${props.className ? ` ${props.className}` : ''}`}
                // A fresh press clears a stale flag (the click after a press on the backdrop may
                // never reach the trigger).
                onPointerDown={() => (pressClosed = false)}
                onClick={() => {
                    if (pressClosed) {
                        pressClosed = false
                        return
                    }
                    if (open()) close()
                    else openPicker()
                }}
            >
                <Text
                    as="span"
                    inherit
                    class={parsed().date ? undefined : styles.placeholder}
                >
                    {label()}
                </Text>
                <Icon value="Calendar" class={styles.icon} />
            </FormControl>
            <AnchoredPopover
                anchor={() => triggerRef}
                onAnchorPress={() => {
                    pressClosed = true
                    close()
                }}
                open={open()}
                onDismiss={() => {
                    close()
                    props.onDismiss?.()
                }}
                panelAttrs={{ 'data-testid': 'date-field-popover' }}
            >
                {/* AnchoredPopover resolves its children ONCE at setup, so a bare DatePicker here was
                    built at mount with the initial (empty) date and never saw the value again — an
                    open picker over a filled field showed a blank date. `<Show>` builds it on each
                    open, from the value openPicker() just read. */}
                <Show when={open()}>
                    <div style={{ 'min-width': `${triggerWidth()}px` }}>
                        <DatePicker
                            kind={kind()}
                            initialDate={lastDate}
                            initialTime={lastTime}
                            {...{ options }}
                            onDateChange={(v, closeAfter) => {
                                lastDate = v
                                commit(v, lastTime, closeAfter)
                            }}
                            onTimeChange={v => {
                                lastTime = v
                                commit(lastDate, v, true)
                            }}
                            onPick={i => {
                                lastDate = options[i].date
                                commit(lastDate, lastTime, true)
                            }}
                        />
                    </div>
                </Show>
            </AnchoredPopover>
        </>
    )
}

export default DateFieldEditor
