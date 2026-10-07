// app/src/ui/ascii/AsciiTree.tsx
// The vault file tree, drawn with typed connectors. Ported from
// bismuth-design/ascii/design-system/components/ascii/AsciiTree.jsx (React reference) to Solid.
// Connectors are plain ASCII (never box-drawing); each row carries the surface glyph for
// its kind (folder/note/base/agent/daemon). Styles are colocated in AsciiTree.module.css.
import { For, type Component } from 'solid-js'
import { isActivateKey } from '../widgetKeys'
import { ancestorsLastOf, treePrefix } from './treePrefix'
import styles from './AsciiTree.module.css'

export type AsciiTreeRow = {
    id: string
    label: string
    depth?: number
    last?: boolean
    /** Surface glyph, e.g. folder/note/base/agent/daemon marker. */
    glyph?: string
    /** Right-hand count, e.g. "(3)". Right-aligned in its own slot at the row's trailing edge. */
    meta?: string
}

export type AsciiTreeProps = {
    rows: AsciiTreeRow[]
    activeId?: string
    onSelect?: (id: string) => void
    class?: string
}

/**
 * The vault tree. Connectors are typed characters; each row carries the surface
 * glyph for its kind. Never substitute box-drawing characters for `|--` / `` `-- ``.
 *
 * A row under a LAST folder draws a blank column there, not a `|` — `ancestorsLast` is derived
 * from the flat rows' own `depth`/`last`, so callers pass nothing extra.
 */
const AsciiTree: Component<AsciiTreeProps> = props => {
    const ancestors = () => ancestorsLastOf(props.rows)
    // The row is a treeitem with a real keyboard path: Tab reaches it, Enter/Space selects it —
    // the native button pair (isActivateKey), not a rebindable command. (Nothing draws a focus
    // ring — DESIGN.md's focus rule.)
    const onKeyDown = (e: KeyboardEvent, id: string) => {
        if (!isActivateKey(e)) return
        e.preventDefault()
        props.onSelect?.(id)
    }
    return (
        <div
            class={`${styles['asc-tree']} ${props.class ?? ''}`}
            role="tree"
        >
            <For each={props.rows}>
                {(r, i) => (
                    <div
                        classList={{
                            [styles['asc-tree-row']!]: true,
                            [styles.active!]: r.id === props.activeId,
                        }}
                        role="treeitem"
                        aria-selected={r.id === props.activeId}
                        tabindex={0}
                        onClick={() => props.onSelect?.(r.id)}
                        onKeyDown={e => onKeyDown(e, r.id)}
                    >
                        <span class={styles['asc-tree-text']}>
                            {treePrefix(
                                r.depth ?? 0,
                                !!r.last,
                                ancestors()[i()] ?? [],
                            )}
                            {r.glyph ? r.glyph + ' ' : ''}
                            {r.label}
                        </span>
                        {r.meta ? (
                            <span class={styles['asc-tree-meta']}>{r.meta}</span>
                        ) : null}
                    </div>
                )}
            </For>
        </div>
    )
}

export default AsciiTree
