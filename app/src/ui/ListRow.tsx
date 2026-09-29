// app/src/ui/ListRow.tsx
// One row of a RowList: an optional leading control (a swatch, a mark), the main content, and an
// optional trailing control (a remove `[x]`, an `[+ add]`). Non-interactive itself — its slots
// hold the real controls — so a row can carry several buttons without nesting one in another.
//
// The metrics are the app's list row, taken from daemon/DaemonRow: `--row-h` plus `--sp-1` either
// side (22px), `--sp-3` between slots, `--fs-ui` regular `--fg`, no inline padding so the row's
// first glyph sits on the modal's content edge, no hover fill (clickable rows never paint a
// background — user decision 2026-09-23). `reveal` hides the trailing control until the row is
// hovered or holds focus, as DaemonRow does with `[run]`. Three rows that must line up — the
// category rows and the add row under them — line up because they are the same component, not
// because three stylesheets agree.
import { children, Show, type Component, type JSX } from 'solid-js'
import styles from './ListRow.module.css'

export type ListRowProps = {
    /** Leading control, e.g. a ColorChip. Never shrinks. */
    leading?: JSX.Element
    /** The main slot, which takes the remaining width. */
    children: JSX.Element
    /** Trailing control, e.g. a RemoveRowButton. Never shrinks. */
    trailing?: JSX.Element
    /** Hide `trailing` until the row is hovered or the trailing control holds focus (always shown on touch). */
    reveal?: boolean
    class?: string
}

const ListRow: Component<ListRowProps> = props => {
    // Resolve each slot ONCE. A JSX prop is a getter that builds a fresh instance on every read, so
    // `<Show when={props.leading}>{props.leading}</Show>` mounted one ColorChip and left a second,
    // orphaned one alive whose portaled popover answered the clicks.
    const leading = children(() => props.leading)
    const trailing = children(() => props.trailing)
    return (
        <div
            class={[styles.row, props.reveal ? styles.reveal : '', props.class ?? '']
                .filter(Boolean)
                .join(' ')}
            data-testid="list-row"
        >
            <Show when={leading()}>
                <div class={styles.edge}>{leading()}</div>
            </Show>
            <div class={styles.main}>{props.children}</div>
            <Show when={trailing()}>
                <div class={`${styles.edge} ${styles.trailing}`}>{trailing()}</div>
            </Show>
        </div>
    )
}

export default ListRow
export { ListRow }
