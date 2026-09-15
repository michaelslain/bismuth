// app/src/preview/OutlineTree.tsx
// A PDF's embedded outline (its table of contents) as a collapsible, file-tree-style tree: ASCII
// connector prefixes from outlinePrefix.ts, a disclosure toggle on every node with children (open
// by default), and a click (or Enter) on a node with a resolved page jumps there. A node whose
// destination didn't resolve (`page: null`) still shows, dimmed, and does nothing on click.
// Recursive: each open node renders its children as a nested OutlineTree one level deeper.
//
// Matches FileTree's own row shape (FileTree.tsx's Level renderer, ~line 1288): the FULL ASCII
// connector (trimEnd'd), then ONE fixed-width disclosure slot, then the title — never a chevron
// stamped OVER part of the connector text. FileTree gets away with no separate slot at all
// because its folder icon doubles as the disclosure glyph (Folder open/closed) and is always
// present; an outline node has no such icon, so a LEAF needs an equally-wide BLANK where a
// parent's toggle would go — that is what keeps sibling titles aligned regardless of whether the
// node has children, and what keeps a depth+1 title exactly one prefix-step right of its parent's
// (the slot's width is constant across depths, so it cancels out of that difference; only the
// connector text itself grows by one step per depth).
import { createSignal, For, Show } from 'solid-js'
import type { OutlineNode } from './annotationTypes'
import { outlinePrefix } from './outlinePrefix'
import IconButton from '../ui/IconButton'
import Label from '../ui/Label'
import styles from './OutlineTree.module.css'

export type OutlineTreeProps = {
    nodes: OutlineNode[]
    onJump: (page: number) => void
    /** Nesting level of `nodes`; 0 (default) for the top of the outline. */
    depth?: number
    /** `last` flag of every ancestor above `nodes`, outermost first — internal recursion only;
     *  top-level callers omit it (defaults to `[]`, i.e. no ancestors). Threading this down is
     *  what lets `outlinePrefix` leave an ancestor's column blank once that ancestor was itself a
     *  last child, instead of drawing a `|` under it forever. */
    ancestorsLast?: boolean[]
    class?: string
}

function OutlineTree(props: OutlineTreeProps) {
    const depth = () => props.depth ?? 0
    const ancestorsLast = () => props.ancestorsLast ?? []
    return (
        <div
            class={props.class}
            role={depth() === 0 ? 'tree' : 'group'}
            aria-label={depth() === 0 ? 'Outline' : undefined}
        >
            <For each={props.nodes}>
                {(node, i) => {
                    const [open, setOpen] = createSignal(true)
                    const hasChildren = () => node.children.length > 0
                    const isLast = () => i() === props.nodes.length - 1
                    const jump = () => {
                        if (node.page !== null) props.onJump(node.page)
                    }
                    return (
                        <>
                            <div
                                classList={{
                                    [styles['outline-row']!]: true,
                                    [styles['outline-row--dead']!]:
                                        node.page === null,
                                }}
                                role="treeitem"
                                tabindex="0"
                                aria-level={depth() + 1}
                                aria-expanded={
                                    hasChildren() ? open() : undefined
                                }
                                data-outline-depth={depth()}
                                onClick={jump}
                                onKeyDown={e => {
                                    if (e.target !== e.currentTarget) return
                                    if (e.key === 'Enter') jump()
                                    else if (
                                        e.key === 'ArrowRight' &&
                                        hasChildren()
                                    )
                                        setOpen(true)
                                    else if (
                                        e.key === 'ArrowLeft' &&
                                        hasChildren()
                                    )
                                        setOpen(false)
                                }}
                            >
                                <Label class={styles['outline-prefix']}>
                                    {outlinePrefix(
                                        ancestorsLast(),
                                        isLast(),
                                    ).trimEnd()}
                                </Label>
                                {/* Fixed-width disclosure slot — ALWAYS occupies this width,
                                    whether or not it holds a toggle button, exactly like
                                    FileTree's icon column. A node's click is its own — it must
                                    not also jump. */}
                                <span
                                    class={styles['outline-disclosure']}
                                    onClick={e =>
                                        hasChildren() && e.stopPropagation()
                                    }
                                    onPointerDown={e =>
                                        hasChildren() && e.stopPropagation()
                                    }
                                    onKeyDown={e =>
                                        hasChildren() && e.stopPropagation()
                                    }
                                >
                                    <Show when={hasChildren()}>
                                        <IconButton
                                            icon={
                                                open()
                                                    ? 'ChevronDown'
                                                    : 'ChevronRight'
                                            }
                                            label={
                                                open() ? 'Collapse' : 'Expand'
                                            }
                                            aria-expanded={open()}
                                            onClick={() => setOpen(o => !o)}
                                        />
                                    </Show>
                                </span>
                                <Label fill class={styles['outline-title']}>
                                    {node.title}
                                </Label>
                                <Show when={node.page !== null}>
                                    <Label
                                        tone="faint"
                                        class={styles['outline-page']}
                                    >
                                        {`p.${node.page! + 1}`}
                                    </Label>
                                </Show>
                            </div>
                            <Show when={hasChildren() && open()}>
                                <OutlineTree
                                    nodes={node.children}
                                    onJump={props.onJump}
                                    depth={depth() + 1}
                                    ancestorsLast={[
                                        ...ancestorsLast(),
                                        isLast(),
                                    ]}
                                />
                            </Show>
                        </>
                    )
                }}
            </For>
        </div>
    )
}

export default OutlineTree
