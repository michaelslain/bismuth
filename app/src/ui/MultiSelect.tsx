// app/src/ui/MultiSelect.tsx
// A dropdown of toggleable choices — the picker behind `tags`/`multiselect` base properties
// (PropertyValueEditor.tsx). Reads as Select's sibling: same trigger chrome (FormControl-as-
// button + a caret), the same popover family (AnchoredPopover + PopoverList + createMenuNav),
// but every row TOGGLES instead of choosing-and-closing, so the list stays open across several
// picks. A filter input at the top narrows the rows and, when `creatable`, doubles as the "add
// a new value" field for an unmatched entry (Enter with no matching row appends it verbatim).
import { createMemo, createSignal, onMount } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import PopoverList from './popover/PopoverList'
import { createMenuNav } from './popover/createMenuNav'
import BracketToggle from './BracketToggle'
import FormControl from './FormControl'
import TextInput from './TextInput'
import { isConfirmKey } from './widgetKeys'
import styles from './MultiSelect.module.css'

export type MultiSelectProps = {
    value: string[]
    options: string[]
    /** Fired on every toggle — the list stays open, so a caller wanting "keep editing" behavior
     *  (PropertyValueEditor's multiselect/tags branches) needs no extra plumbing. */
    onChange: (next: string[]) => void
    /** Enter on a filter that matches no existing row appends it as a new selected value. */
    creatable?: boolean
    /** Escape or an outside click. */
    onClose?: () => void
    /** Start open — a table cell that opens straight into the editor sets this. Read once, at
     *  mount, like `autofocus` elsewhere in this file's siblings. */
    open?: boolean
    placeholder?: string
    class?: string
}

/** `order` filtered by a case-insensitive substring match, keeping its relative order. Takes an
 *  already-ordered list rather than computing selected-first itself — see `MultiSelect`'s
 *  `openMenu`/`order` for why: recomputing "selected first" on every toggle moves the row you
 *  just clicked out from under your cursor mid-session. */
export function visibleOptions(order: string[], filter: string): string[] {
    const q = filter.trim().toLowerCase()
    const matches = (o: string) => !q || o.toLowerCase().includes(q)
    return order.filter(matches)
}

/** Selected-first ordering of `options`, computed once (at open) rather than on every render —
 *  the fixed order `visibleOptions` then filters. */
function selectedFirst(options: string[], value: string[]): string[] {
    const selected = options.filter(o => value.includes(o))
    const rest = options.filter(o => !value.includes(o))
    return [...selected, ...rest]
}

function MultiSelect(props: MultiSelectProps) {
    const [open, setOpen] = createSignal(props.open ?? false)
    const [filter, setFilter] = createSignal('')
    // The row order while the list is open, frozen at the moment it opened (see `selectedFirst`).
    // Toggling a row changes `props.value` but must NOT reshuffle this — that is what used to
    // move the just-clicked row out from under the pointer, so a second click landed on a
    // DIFFERENT option than the one the user meant to toggle back.
    const [order, setOrder] = createSignal<string[]>(
        selectedFirst(props.options, props.value),
    )
    let triggerRef: HTMLButtonElement | undefined
    let filterRef: HTMLInputElement | undefined

    const rows = createMemo(() => visibleOptions(order(), filter()))
    const canCreate = createMemo(() => {
        if (!props.creatable) return false
        const q = filter().trim()
        if (!q) return false
        return !props.options.some(o => o.toLowerCase() === q.toLowerCase())
    })

    function toggle(v: string): void {
        const next = props.value.includes(v)
            ? props.value.filter(x => x !== v)
            : [...props.value, v]
        props.onChange(next)
        // A clicked row takes focus, then PopoverList rebuilds every row (its items are fresh
        // objects each render) and focus falls to <body> — typing and arrow keys go nowhere
        // until the user clicks back into the filter. The filter is this list's keyboard home.
        queueMicrotask(() => filterRef?.focus())
    }

    function create(): void {
        const v = filter().trim()
        if (!v) return
        props.onChange([...props.value, v])
        // A brand-new value isn't in `props.options` (frozen for the editor's whole open span —
        // see TableCell.tsx), so it needs adding to the frozen order too, or it would toggle
        // selected while staying invisible in the list.
        setOrder(o => (o.includes(v) ? o : [v, ...o]))
        setFilter('')
        nav.setActive(0)
    }

    const nav = createMenuNav({
        count: () => rows().length,
        onSelect: i => {
            const v = rows()[i]
            if (v) toggle(v)
        },
        onEscape: () => close(),
        wrap: true,
    })

    function openMenu(): void {
        setOrder(selectedFirst(props.options, props.value))
        nav.setActive(rows().length ? 0 : -1)
        setOpen(true)
        queueMicrotask(() => filterRef?.focus())
    }
    function close(): void {
        setOpen(false)
        setFilter('')
        triggerRef?.focus()
        props.onClose?.()
    }

    onMount(() => {
        if (props.open) queueMicrotask(() => filterRef?.focus())
    })

    return (
        <>
            <FormControl
                as="button"
                ref={triggerRef}
                type="button"
                class={`${styles.trigger} ${props.class ?? ''}`}
                onClick={() => (open() ? close() : openMenu())}
                onKeyDown={e => {
                    if (open()) return
                    if (
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
                    class={styles.value}
                    classList={{
                        [styles.placeholder!]: props.value.length === 0,
                    }}
                >
                    {props.value.length
                        ? props.value.join(', ')
                        : (props.placeholder ?? 'Select…')}
                </span>
                <span class={styles.caret} aria-hidden="true">
                    ▾
                </span>
            </FormControl>
            <AnchoredPopover
                anchor={() => triggerRef}
                open={open()}
                onDismiss={close}
            >
                <div class={styles.panel}>
                    <TextInput
                        ref={filterRef}
                        class={styles.filter}
                        value={filter()}
                        onInput={v => {
                            setFilter(v)
                            nav.setActive(0)
                        }}
                        placeholder={
                            props.creatable ? 'filter or add' : 'filter'
                        }
                        onKeyDown={e => {
                            e.stopPropagation()
                            if (
                                isConfirmKey(e) &&
                                rows().length === 0 &&
                                canCreate()
                            ) {
                                e.preventDefault()
                                create()
                                return
                            }
                            nav.onKeyDown(e)
                        }}
                    />
                    <PopoverList
                        items={rows().map(o => ({
                            label: o,
                            prefix: (
                                <BracketToggle
                                    checked={props.value.includes(o)}
                                />
                            ),
                        }))}
                        active={nav.active()}
                        onActivate={i => {
                            const v = rows()[i]
                            if (v) toggle(v)
                        }}
                        onHover={nav.setActive}
                        class={styles.list}
                    />
                </div>
            </AnchoredPopover>
        </>
    )
}

export default MultiSelect
