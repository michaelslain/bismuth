// app/src/ui/PaletteRow.tsx
// THE selectable result row: icon, label (with optional fuzzy-match highlighting), optional detail
// line, optional sublabel, optional shortcut. Promoted from palette/ because it is the winner of a
// four-way split — SearchResultRows, chat/ChatHistoryRow, GraphSearch and ui/popover/MenuRow each
// reimplement it, with four different names for one keyboard cursor (`data-selected`,
// `data-active`, a local `.selected` class, a `--selected` modifier). The selection hook is
// `data-selected` EVERYWHERE from here on: it is a runtime hook (not a hashed class) so a generic
// `scrollSelectedIntoView` selector can reach rows AND `.sresult` cards in one list.
//
// Semantics: the row is `role="option"` with `aria-selected`; its parent list must be
// `role="listbox"` (and name the active row through `aria-activedescendant`, which needs the row's
// `id`). The row paints no hover background — see PaletteRow.module.css.
import { Show, createMemo, For, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import { toSegments } from '../palette/rankItems'
import Label from './Label'
import Text from './Text'
import styles from './PaletteRow.module.css'

export type PaletteRowProps = {
    /** The keyboard cursor. Renders `data-selected` + `aria-selected`; the row has no hover fill. */
    selected?: boolean
    icon?: string
    /** A string, or a `<Highlight>` for fuzzy-matched characters. */
    label: JSX.Element
    /** Second line under the label (a template description, etc.). */
    detail?: JSX.Element
    /** Right-aligned secondary text (a folder, a kind). */
    sublabel?: JSX.Element
    /** Right-edge chord — a string or a `<Kbd muted>`. */
    shortcut?: JSX.Element
    /** Commit this row (click). */
    onPick?: () => void
    /** NOT A PROP — the commit handler is `onPick`. Declared `never` so a surplus `onClick`, which
     *  this component would otherwise silently drop, is a compile error instead of a dead row. */
    onClick?: never
    /** Pointer moved over the row — the caller's `createPointerGuard` sets the selection. */
    onMouseMove?: (e: MouseEvent) => void
    /** DOM id, so the listbox's `aria-activedescendant` can name this row. */
    id?: string
    testid?: string
    class?: string
}

/** A single selectable row. All parts are optional except `label`. */
function PaletteRow(props: PaletteRowProps) {
    return (
        <div
            role="option"
            aria-selected={props.selected ? 'true' : 'false'}
            id={props.id}
            class={`${styles['palette-row']} ${props.class ?? ''}`}
            data-selected={props.selected ? '' : undefined}
            data-testid={props.testid}
            onMouseMove={e => props.onMouseMove?.(e)}
            onClick={() => props.onPick?.()}
        >
            <Show when={props.icon}>
                <Text as="span" inherit class={styles['palette-icon']}>
                    <Icon value={props.icon!} />
                </Text>
            </Show>
            <Text as="span" inherit class={styles['palette-text']}>
                <Label fill class={styles['palette-label']}>
                    {props.label}
                </Label>
                <Show when={props.detail}>
                    <Text as="span" inherit class={styles['palette-desc']}>
                        {props.detail}
                    </Text>
                </Show>
            </Text>
            <Show when={props.sublabel}>
                <Label tone="faint" class={styles['palette-sub']}>
                    {props.sublabel}
                </Label>
            </Show>
            <Show when={props.shortcut}>
                <Text as="span" inherit class={styles['palette-shortcut']}>
                    {props.shortcut}
                </Text>
            </Show>
        </div>
    )
}

export default PaletteRow

/** The row's own hashed class, for the callers that must build a CSS selector string
 *  (`scrollSelectedIntoView`'s `.${paletteRowClass}[data-selected]`) rather than apply the class —
 *  keeps them from importing PaletteRow.module.css themselves. */
export const paletteRowClass = styles['palette-row']

/** Render a label with its fuzzy-matched characters highlighted. */
export function Highlight(p: { text: string; indices: number[] }) {
    const segments = createMemo(() => toSegments(p.text, p.indices))
    return (
        <For each={segments()}>
            {s =>
                s.match ? (
                    <Text as="span" inherit class={styles['palette-match']}>
                        {s.text}
                    </Text>
                ) : (
                    <>{s.text}</>
                )
            }
        </For>
    )
}
