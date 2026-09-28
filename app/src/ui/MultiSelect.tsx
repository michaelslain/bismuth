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

/** Selected values (in `options`' own order) first, then the rest, each group filtered by a
 *  case-insensitive substring match and keeping its relative order — never re-sorted. */
export function visibleOptions(
    options: string[],
    value: string[],
    filter: string,
): string[] {
    const q = filter.trim().toLowerCase()
    const matches = (o: string) => !q || o.toLowerCase().includes(q)
    const selected = options.filter(o => value.includes(o) && matches(o))
    const rest = options.filter(o => !value.includes(o) && matches(o))
    return [...selected, ...rest]
}

function MultiSelect(props: MultiSelectProps) {
    const [open, setOpen] = createSignal(props.open ?? false)
    const [filter, setFilter] = createSignal('')
    let triggerRef: HTMLButtonElement | undefined
    let filterRef: HTMLInputElement | undefined

    const rows = createMemo(() =>
        visibleOptions(props.options, props.value, filter()),
    )
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
    }

    function create(): void {
        const v = filter().trim()
        if (!v) return
        props.onChange([...props.value, v])
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
        nav.setActive(rows().length ? 0 : -1)
        setOpen(true)
        queueMicrotask(() => filterRef?.focus())
    }
    function close(): void {
        setOpen(false)
        setFilter('')
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
            >
                <span
                    class={styles.value}
                    classList={{ [styles.placeholder!]: props.value.length === 0 }}
                >
                    {props.value.length
                        ? props.value.join(', ')
                        : (props.placeholder ?? 'Select…')}
                </span>
                <span class={styles.caret} aria-hidden="true">
                    ▾
                </span>
            </FormControl>
            <AnchoredPopover anchor={() => triggerRef} open={open()} onDismiss={close}>
                <div class={styles.panel}>
                    <TextInput
                        ref={filterRef}
                        class={styles.filter}
                        value={filter()}
                        onInput={v => {
                            setFilter(v)
                            nav.setActive(0)
                        }}
                        placeholder={props.creatable ? 'filter or add' : 'filter'}
                        onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter' && rows().length === 0 && canCreate()) {
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
                            prefix: <BracketToggle checked={props.value.includes(o)} />,
                        }))}
                        active={nav.active()}
                        onActivate={i => {
                            const v = rows()[i]
                            if (v) toggle(v)
                        }}
                        onHover={nav.setActive}
                    />
                </div>
            </AnchoredPopover>
        </>
    )
}

export default MultiSelect
