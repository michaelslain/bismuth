// app/src/ui/BarOverflow.tsx
// The view bar's [≡] trigger and its panel. ViewBar mounts it as the trail's last control only when
// at least one droppable element does not fit, and hands over exactly those elements.
//
// THE PANEL SHOWS THE SAME LIVE CONTROLS, NOT COPIES. While the panel is open each dropped element
// is MOVED into its row (a comment node holds its place in the bar) and moved back when the row
// goes away, so a click in the panel runs the real handler, a selected toggle shows selected, and a
// `<Show>` inside the element keeps working. Nothing is re-implemented.
import { createSignal, For, onCleanup, Show, type Component } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import IconButton from './IconButton'
import Label from './Label'
import Popover from './Popover'
import styles from './BarOverflow.module.css'

export type BarOverflowItem = {
    /** Row label, lowercase words (`zoom`, `dark mode`). */
    label: string
    /** The dropped element itself. */
    el: HTMLElement
}

export type BarOverflowProps = {
    /** The dropped elements, in bar order. */
    items: BarOverflowItem[]
    open: boolean
    onOpenChange: (open: boolean) => void
    class?: string
}

/** One panel row: the label, and every live element sharing it in the slot, in bar order. Each
 *  element is restored to its own placeholder when the row goes away. An element whose owner
 *  removed it while it sat here (a `<Show>` flipping false) is not put back: it is gone. */
const Row: Component<{ label: string; els: HTMLElement[] }> = props => {
    const mount = (slot: HTMLElement) => {
        const parts = props.els.map(el => {
            const home = document.createComment('bar-overflow')
            el.replaceWith(home)
            slot.appendChild(el)
            return { el, home }
        })
        // An element its owner removed from the DOM while it sat in the panel (not connected any
        // more) is not put back; its placeholder goes with it. Solid's own `<Show>` removal of a
        // sibling-array child never reaches a node living outside the bar, and the story
        // ViewBar `DroppedElementUnmountsWhileOpen` proves the bar holds no ghost afterwards.
        onCleanup(() => {
            for (const { el, home } of parts) {
                if (el.isConnected || el.parentNode === slot) home.replaceWith(el)
                else home.remove()
            }
        })
    }
    return (
        <div class={styles.row}>
            <Label tone="muted">{props.label}</Label>
            <div class={styles.slot} ref={mount} />
        </div>
    )
}

/** Dropped items grouped by label, in first-occurrence order. */
const groupByLabel = (items: BarOverflowItem[]): { label: string; els: HTMLElement[] }[] => {
    const groups: { label: string; els: HTMLElement[] }[] = []
    for (const item of items) {
        const g = groups.find(x => x.label === item.label)
        if (g) g.els.push(item.el)
        else groups.push({ label: item.label, els: [item.el] })
    }
    return groups
}

const BarOverflow: Component<BarOverflowProps> = props => {
    const [anchor, setAnchor] = createSignal<HTMLElement>()
    const close = () => {
        props.onOpenChange(false)
        anchor()?.focus()
    }
    // A window resize closes the panel: its anchor has moved.
    const onResize = () => props.open && props.onOpenChange(false)
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
    // Focus lands on the rows container, not the first control: a focused control shows its
    // tooltip (focus-visible), which would cover the panel. Tab moves into the controls.
    const focusIn = (rows: HTMLElement) => queueMicrotask(() => rows.focus())
    return (
        <>
            <IconButton
                icon="Menu"
                label="More controls"
                size="sm"
                variant={props.open ? 'selected' : 'unselected'}
                aria-haspopup="true"
                aria-expanded={props.open}
                class={props.class}
                data-bar-overflow
                ref={setAnchor}
                onClick={e => {
                    setAnchor(e.currentTarget)
                    props.onOpenChange(!props.open)
                }}
            />
            <AnchoredPopover
                open={props.open}
                anchor={anchor}
                toggleEl={anchor}
                onAnchorPress={close}
                onDismiss={close}
                placement="below"
                align="end"
            >
                {/* AnchoredPopover resolves its children eagerly, closed or not; the Show keeps the
                    rows (which MOVE the live elements) from existing until the panel is open. */}
                <Show when={props.open}>
                    <Popover tone="panel">
                        <div
                            class={styles.rows}
                            tabindex="-1"
                            ref={el => {
                                focusIn(el)
                            }}
                        >
                            <For each={groupByLabel(props.items)}>
                                {g => <Row label={g.label} els={g.els} />}
                            </For>
                        </div>
                    </Popover>
                </Show>
            </AnchoredPopover>
        </>
    )
}

export default BarOverflow
