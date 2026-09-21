// app/src/bases/DateFieldEditor.tsx
// A date property as ONE input-height control: a FormControl trigger (the same `.ui-input`
// chrome TextInput/Select use) showing the value or a muted placeholder, which opens the app's
// DatePicker (editor/DatePicker.tsx) anchored under the trigger by `<AnchoredPopover>`.
//
// Why not ui/Popover: Popover is only the floating SURFACE (border + --lift), with no anchoring,
// and DatePicker already paints that surface itself (`.bismuth-popover`) — wrapping it would
// draw two frames. So this owns only the anchor + dismiss layer, same as ui/Select.tsx.
import { createSignal, type Component } from 'solid-js'
import AnchoredPopover from '../ui/AnchoredPopover'
import DatePicker, { type DatePickerKind } from '../editor/DatePicker'
import { parseDateValue, composeDateValue } from '../editor/datePickerCore'
import FormControl from '../ui/FormControl'
import Text from '../ui/Text'
import { Icon } from '../icons/Icon'
import { dateFieldPresets } from './dateFieldPresets'
import styles from './DateFieldEditor.module.css'

export type DateFieldEditorProps = {
    /** `true` stores `YYYY-MM-DDTHH:MM`, else a bare `YYYY-MM-DD`. */
    time?: boolean
    value: unknown
    onCommit: (value: unknown) => void
    placeholder?: string
    className?: string
}

const DateFieldEditor: Component<DateFieldEditorProps> = props => {
    const [open, setOpen] = createSignal(false)
    const [triggerWidth, setTriggerWidth] = createSignal(0)
    let triggerRef: HTMLButtonElement | undefined
    let lastDate = ''
    let lastTime = ''
    const options = dateFieldPresets()

    const kind = (): DatePickerKind => (props.time ? 'datetime' : 'date')
    const parsed = () => parseDateValue(String(props.value ?? ''))
    const label = () => {
        const p = parsed()
        if (!p.date) return props.placeholder ?? 'Set date…'
        return kind() === 'datetime' && p.time ? `${p.date} ${p.time}` : p.date
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
                onClick={() => (open() ? close() : openPicker())}
            >
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={parsed().date ? undefined : styles.placeholder}
                >
                    {label()}
                </Text>
                <Icon value="Calendar" size={14} class={styles.icon} />
            </FormControl>
            <AnchoredPopover
                anchor={() => triggerRef}
                open={open()}
                onDismiss={close}
                panelAttrs={{ 'data-testid': 'date-field-popover' }}
            >
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
            </AnchoredPopover>
        </>
    )
}

export default DateFieldEditor
