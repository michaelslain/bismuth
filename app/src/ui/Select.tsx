import { createSignal } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import PopoverList from './popover/PopoverList'
import { createMenuNav } from './popover/createMenuNav'
import FormControl from './FormControl'
import styles from './Select.module.css'

/** `detail` renders as the muted right-side text on the option's row (MenuRow detail) — e.g. the
 *  chat model picker's Free/Paid badge. The closed trigger shows only the label. */
export type SelectOption = { value: string; label: string; detail?: string }

/**
 * A custom dropdown that replaces the native `<select>`. The trigger reuses the
 * `.ui-input` chrome (so it matches TextInput); the open list is the shared
 * `<PopoverList>` surface (same chrome as the context menu + autocomplete) with
 * `createMenuNav` for keyboard, anchored under the trigger by `<AnchoredPopover>`
 * (portaled to <body> so it escapes the modal's overflow and layers above it).
 */
export type SelectProps = {
    value: string
    options: SelectOption[]
    onChange: (value: string) => void
    /** Shown, muted, while `value` is empty (and, with no placeholder, "Select…"). */
    placeholder?: string
    /** Accessible name for the trigger, for a Select with no visible caption of its own (a filter
     *  row's three selects). Inside a SettingsField the field's own label names it instead. */
    label?: string
    /** Not openable; the trigger reads `--faint` with the dashed rule, no hover. */
    disabled?: boolean
    class?: string
    /** Appended to the trigger button's own class, alongside `class` (the root). Lets a caller
     *  style the trigger specifically without a `:global()` reach into `.ui-select-trigger`. */
    triggerClass?: string
    /** Appended to the caret glyph's class — e.g. a caller that wants to hide it entirely
     *  (ChatControls' quiet row) without reaching `:global(.ui-select-caret)`. */
    caretClass?: string
    /** Fired when the popover closes WITHOUT a choice — Escape or a backdrop click — as
     *  opposed to `close()` after `choose()`, which already reported the new value via
     *  `onChange`. Lets a caller that swaps in a Select as a transient editor (the kanban
     *  meta chip editor) restore its own read-only state on a plain dismiss, matching the
     *  Escape-to-cancel behavior of its sibling text/number/date inputs. Optional — callers
     *  that don't host a transient editor (e.g. a settings row) can ignore it. */
    onDismiss?: () => void
}

function Select(props: SelectProps) {
    const [open, setOpen] = createSignal(false)
    let triggerRef: HTMLButtonElement | undefined
    // The trigger's measured width, for the open list's min-width — captured on open so it
    // never lags a resize the same way the anchored position itself does (AnchoredPopover
    // re-measures the trigger's rect on every reposition; only the width needs to reach the
    // list's own inline style).
    const [triggerWidth, setTriggerWidth] = createSignal(0)

    const current = () => props.options.find(o => o.value === props.value)
    // An EMPTY value is "nothing chosen" even when an option carries it (a "(clear)" row): the
    // trigger then reads as a placeholder — muted — never as a chosen value in full ink.
    const empty = () => props.value === ''
    const shown = () =>
        empty()
            ? (props.placeholder ?? current()?.label ?? 'Select…')
            : (current()?.label ?? props.placeholder ?? 'Select…')

    const nav = createMenuNav({
        count: () => props.options.length,
        onSelect: i => choose(i),
        onEscape: () => dismiss(),
        wrap: true,
    })

    function openMenu() {
        if (!triggerRef) return
        setTriggerWidth(triggerRef.getBoundingClientRect().width)
        const idx = props.options.findIndex(o => o.value === props.value)
        nav.setActive(idx >= 0 ? idx : 0)
        setOpen(true)
    }
    function close() {
        setOpen(false)
        triggerRef?.focus()
    }
    /** Close WITHOUT a selection — Escape or a backdrop click. */
    function dismiss() {
        close()
        props.onDismiss?.()
    }
    function choose(i: number) {
        const opt = props.options[i]
        if (opt) props.onChange(opt.value)
        close()
    }

    return (
        <>
            <FormControl
                as="button"
                ref={triggerRef}
                type="button"
                disabled={props.disabled}
                aria-label={props.label}
                aria-haspopup="listbox"
                aria-expanded={open()}
                data-select-trigger=""
                class={`${styles['ui-select-trigger']} ${props.class ?? ''} ${props.triggerClass ?? ''}`}
                onClick={() => (open() ? close() : openMenu())}
                onKeyDown={e => {
                    if (open()) {
                        // The open menu's keys are stopped from bubbling AND its Escape is
                        // defaultPrevented (createMenuNav) — the latter is what a window-level
                        // Modal listener checks, so Escape closes only this menu.
                        e.stopPropagation()
                        nav.onKeyDown(e)
                    } else if (
                        e.key === 'ArrowDown' ||
                        e.key === 'Enter' ||
                        e.key === ' '
                    ) {
                        e.preventDefault()
                        e.stopPropagation()
                        openMenu()
                    }
                }}
            >
                <span
                    class={styles['ui-select-value']}
                    classList={{
                        [styles['ui-select-placeholder']!]: empty() || !current(),
                    }}
                >
                    {shown()}
                </span>
                <span
                    class={`${styles['ui-select-caret']} ${props.caretClass ?? ''}`}
                    data-select-caret=""
                    aria-hidden="true"
                >
                    ▾
                </span>
            </FormControl>
            <AnchoredPopover
                anchor={() => triggerRef}
                open={open()}
                onDismiss={dismiss}
                backdropClass={styles['ui-select-backdrop']}
                backdropAttrs={{ 'data-select-backdrop': true }}
            >
                <PopoverList
                    items={props.options.map(o => ({
                        label: o.label,
                        detail: o.detail,
                        // Every row reserves the icon cell: the chosen row draws the Check, the
                        // rest an empty gutter of the same width, so labels share one left edge.
                        icon: o.value === props.value ? 'Check' : undefined,
                        prefix:
                            o.value === props.value ? undefined : (
                                <span
                                    class={styles['ui-select-gutter']}
                                    aria-hidden="true"
                                />
                            ),
                    }))}
                    active={nav.active()}
                    onActivate={choose}
                    onHover={nav.setActive}
                    style={{ 'min-width': `${triggerWidth()}px` }}
                />
            </AnchoredPopover>
        </>
    )
}

export default Select
