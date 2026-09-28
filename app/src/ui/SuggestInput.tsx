import { createEffect, createMemo, createSignal, type Component } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import PopoverList from './popover/PopoverList'
import { createMenuNav } from './popover/createMenuNav'
import TextInput from './TextInput'
import { isConfirmKey, isDismissKey, isTabKey } from './widgetKeys'
import styles from './SuggestInput.module.css'

// The listbox's own spatial key (the same one createMenuNav moves on), named so the first-press
// rule below reads as a rule; not a rebindable command.
const ARROW_DOWN = 'ArrowDown'

export type SuggestOption = { value: string; label?: string; detail?: string }

export type SuggestInputProps = {
    value: string
    options: SuggestOption[]
    onInput: (value: string) => void
    placeholder?: string
    class?: string
}

/**
 * A text field with a suggestion popup — replaces the native `<datalist>`. Options are filtered by
 * prefix on the label (or value), the first is highlighted (visually), ArrowUp/Down move (the first ArrowDown only activates the
 * highlighted first option). The
 * confirm key and Tab accept the highlighted option ONLY once an arrow key has moved the highlight
 * since the last keystroke or popup close; until then they are not consumed — confirm bubbles to
 * the host (a form's Enter-to-save still works), Tab moves focus, and the typed text stands, as
 * with a native datalist. The dismiss key closes the popup (a second dismiss bubbles to the host).
 * A typed value that matches no option is kept: the field is creatable. The popup is the shared
 * PopoverList surface, as Select's is; OptionRow is a two-line icon+chevron choice row and has no
 * highlighted state, so it does not fit a suggestion row.
 */
const SuggestInput: Component<SuggestInputProps> = props => {
    let rootRef: HTMLDivElement | undefined
    const [open, setOpen] = createSignal(false)
    // True once an arrow key has moved the highlight: only then may confirm/Tab accept it.
    const [touched, setTouched] = createSignal(false)
    const [width, setWidth] = createSignal(0)

    const text = (o: SuggestOption) => o.label ?? o.value
    const filtered = createMemo(() => {
        const q = props.value.trim().toLowerCase()
        return props.options.filter(o => text(o).toLowerCase().startsWith(q))
    })
    const showing = () => open() && filtered().length > 0

    function accept(i: number) {
        const o = filtered()[i]
        if (o) props.onInput(o.value)
        setOpen(false)
    }
    const nav = createMenuNav({
        count: () => filtered().length,
        onSelect: accept,
        wrap: true,
    })
    // A new query is a new list: the first match is always the highlighted one.
    createEffect(() => {
        props.value
        nav.setActive(0)
        setTouched(false)
    })
    createEffect(() => {
        if (showing()) setWidth(rootRef?.getBoundingClientRect().width ?? 0)
        else setTouched(false)
    })

    return (
        <div ref={rootRef} class={[styles['suggest-input'], props.class].filter(Boolean).join(' ')}>
            <TextInput
                value={props.value}
                placeholder={props.placeholder}
                role="combobox"
                aria-expanded={showing()}
                aria-autocomplete="list"
                autocomplete="off"
                onInput={v => {
                    props.onInput(v)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                onKeyDown={e => {
                    if (!showing()) return
                    if (isDismissKey(e)) {
                        e.stopPropagation()
                        setOpen(false)
                    } else if (isConfirmKey(e)) {
                        // Untouched highlight: typed text stands and the key bubbles to the host.
                        if (!touched()) return
                        e.preventDefault()
                        e.stopPropagation()
                        accept(nav.active())
                    } else if (isTabKey(e)) {
                        if (touched()) accept(nav.active())
                    } else if (e.key === ARROW_DOWN && !touched()) {
                        // First ArrowDown from the untouched state activates the option that is
                        // already highlighted (marks touched, does not move), so ArrowDown+Enter
                        // accepts what the eye sees.
                        e.preventDefault()
                        e.stopPropagation()
                        setTouched(true)
                    } else {
                        nav.onKeyDown(e)
                        // Only the arrows are consumed; typing keeps bubbling to the host.
                        if (e.defaultPrevented) {
                            e.stopPropagation()
                            setTouched(true)
                        }
                    }
                }}
            />
            <AnchoredPopover
                anchor={() => rootRef}
                open={showing()}
                onDismiss={() => setOpen(false)}
                backdropClass={styles.backdrop}
            >
                <PopoverList
                    items={filtered().map(o => ({ label: text(o), detail: o.detail }))}
                    active={nav.active()}
                    onActivate={accept}
                    onHover={nav.setActive}
                    style={{ 'min-width': `${width()}px` }}
                />
            </AnchoredPopover>
        </div>
    )
}

export default SuggestInput
