// app/src/preview/OutlineTree.tsx
// A PDF's embedded outline (its table of contents) as a collapsible, file-tree-style tree: ASCII
// connector prefixes from ui/ascii/treePrefix, a disclosure toggle on every node with children
// (open by default), and a click (or Enter) on a node with a resolved page jumps there. A node
// whose destination didn't resolve (`page: null`) still shows, dimmed, and does nothing on click.
// Recursive: each open node renders its children as a nested OutlineTree one level deeper.
import { createSignal, For, Show } from 'solid-js'
import type { OutlineNode } from './annotationTypes'
import { treePrefix } from '../ui/ascii/treePrefix'
import IconButton from '../ui/IconButton'
import Label from '../ui/Label'
import styles from './OutlineTree.module.css'

export type OutlineTreeProps = {
    nodes: OutlineNode[]
    onJump: (page: number) => void
    /** Nesting level of `nodes`; 0 (default) for the top of the outline. */
    depth?: number
    class?: string
}

function OutlineTree(props: OutlineTreeProps) {
    const depth = () => props.depth ?? 0
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
                                    {treePrefix(
                                        depth(),
                                        i() === props.nodes.length - 1,
                                    ).trimEnd()}
                                </Label>
                                <Show
                                    when={hasChildren()}
                                    fallback={
                                        <span
                                            class={styles['outline-spacer']}
                                        />
                                    }
                                >
                                    {/* The toggle's click is its own — it must not also jump. */}
                                    <span
                                        class={styles['outline-toggle']}
                                        onClick={e => e.stopPropagation()}
                                        onPointerDown={e => e.stopPropagation()}
                                        onKeyDown={e => e.stopPropagation()}
                                    >
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
                                    </span>
                                </Show>
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
