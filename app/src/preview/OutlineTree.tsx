// app/src/preview/OutlineTree.tsx
// A PDF's embedded outline (its table of contents) as a collapsible, file-tree-style tree: ASCII
// connector prefixes from outlinePrefix.ts, a disclosure toggle on every node with children (open
// by default), and a click (or Enter) on a node with a resolved page jumps there. A node whose
// destination didn't resolve (`page: null`) still shows, dimmed, with `p.?` in its page column,
// and does nothing on click. Recursive: each open node renders its children as a nested
// OutlineTree one level deeper.
//
// Matches FileTree's own row shape (FileTree.tsx's Level renderer, ~line 1288): the FULL ASCII
// connector (trimEnd'd), then a disclosure slot, then the title — never a chevron stamped OVER
// part of the connector text. A PARENT's slot is one character cell, flanked by one cell either
// side (`|-- ⌄ Introduction` — see OutlineTree.module.css), and the chevron's click target
// overhangs it without taking layout width. A LEAF has no chevron to show, so its slot takes NO
// width at all: its title follows its connector after exactly one character cell
// (`` `-- Background``), not the three a always-reserved blank slot would cost it — the same gap
// a parent's connector-to-chevron cell is, just with nothing after it.
//
// Keyboard + focus follow the WAI-ARIA "tree view" pattern — the same shape FileTree.tsx already
// uses for the file list: the tree is ONE tab stop (`role="tree"` on the outermost container,
// `tabindex="0"`), every row is `tabindex="-1"`, and arrow keys move a roving focus between them.
// Only the outermost (depth 0) call owns the container ref + keydown handler; nested recursive
// calls (depth > 0) render a plain `role="group"` whose rows the outer handler still reaches via
// `[role="treeitem"]` — `querySelectorAll` crosses the nested wrapper divs like any descendant.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { OutlineNode } from './annotationTypes'
import { outlinePrefix } from './outlinePrefix'
import IconButton from '../ui/IconButton'
import Label from '../ui/Label'
import Text from '../ui/Text'
import styles from './OutlineTree.module.css'

export type OutlineTreeProps = {
    nodes: OutlineNode[]
    onJump: (page: number) => void
    /** Index path (through `children`) of the CURRENT section (outlineCurrent.ts's
     *  `currentOutlinePath`) — the row it names gets `aria-current="location"` and the file
     *  tree's own "open file" background. At the top call this is the full path from the
     *  reader's current page; recursive calls receive only the remaining suffix relevant to
     *  their own `nodes`, or `undefined` once the path has branched away from this subtree, so
     *  each row only ever compares its own local index against the path's first element. */
    currentPath?: number[]
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
    const isRoot = () => depth() === 0

    // ── Keyboard navigation (WAI-ARIA tree view, see the file header) ───────────────────────
    // Only meaningful at depth 0 — `rootEl` is only ever assigned there, so `rows()` returns []
    // for every nested recursive instance and their (unused) copies of this handler never fire.
    let rootEl: HTMLDivElement | undefined
    const rows = () =>
        rootEl
            ? ([
                  ...rootEl.querySelectorAll('[role="treeitem"]'),
              ] as HTMLElement[])
            : []
    const focusRow = (el: HTMLElement | undefined) => {
        if (!el) return
        el.focus()
        el.scrollIntoView({ block: 'nearest' })
    }
    const onTreeKeyDown = (e: KeyboardEvent) => {
        const all = rows()
        if (!all.length) return
        const active = document.activeElement as HTMLElement | null
        const i = active ? all.indexOf(active) : -1
        // Focus is on the container itself (the user just tabbed in) — any "go somewhere" key
        // puts focus on the first row rather than being swallowed.
        if (i < 0) {
            if (
                ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(
                    e.key,
                )
            ) {
                e.preventDefault()
                focusRow(all[0])
            }
            return
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                focusRow(all[Math.min(i + 1, all.length - 1)])
                break
            case 'ArrowUp':
                e.preventDefault()
                focusRow(all[Math.max(i - 1, 0)])
                break
            case 'Home':
                e.preventDefault()
                focusRow(all[0])
                break
            case 'End':
                e.preventDefault()
                focusRow(all[all.length - 1])
                break
            case 'ArrowRight': {
                // Open a closed node; step INTO an already-open one. On a leaf (no
                // aria-expanded at all), do nothing rather than swallowing the key.
                const expanded = active!.getAttribute('aria-expanded')
                if (expanded === 'false') {
                    e.preventDefault()
                    active!.querySelector<HTMLButtonElement>('button')?.click()
                } else if (expanded === 'true') {
                    e.preventDefault()
                    focusRow(all[Math.min(i + 1, all.length - 1)])
                }
                break
            }
            case 'ArrowLeft': {
                // Collapse an open node; otherwise walk out to the nearest ancestor row (the
                // closest preceding row at a shallower depth).
                const expanded = active!.getAttribute('aria-expanded')
                if (expanded === 'true') {
                    e.preventDefault()
                    active!.querySelector<HTMLButtonElement>('button')?.click()
                } else {
                    const level = Number(active!.dataset.outlineDepth ?? '0')
                    const parent = all
                        .slice(0, i)
                        .reverse()
                        .find(
                            r =>
                                Number(r.dataset.outlineDepth ?? '0') < level,
                        )
                    if (parent) {
                        e.preventDefault()
                        focusRow(parent)
                    }
                }
                break
            }
            case 'Enter':
                // Reuse the row's own click path (jump) rather than duplicating it here.
                e.preventDefault()
                active!.click()
                break
        }
    }

    return (
        <div
            class={props.class}
            role={isRoot() ? 'tree' : 'group'}
            aria-label={isRoot() ? 'Outline' : undefined}
            tabindex={isRoot() ? '0' : undefined}
            ref={isRoot() ? el => (rootEl = el) : undefined}
            onKeyDown={isRoot() ? onTreeKeyDown : undefined}
        >
            <For each={props.nodes}>
                {(node, i) => {
                    const [open, setOpen] = createSignal(true)
                    const hasChildren = () => node.children.length > 0
                    const isLast = () => i() === props.nodes.length - 1
                    const isCurrent = createMemo(
                        () =>
                            (props.currentPath?.length ?? 0) === 1 &&
                            props.currentPath![0] === i(),
                    )
                    // The remaining path threaded to THIS node's children — only non-empty when
                    // the path continues through this node.
                    const childCurrentPath = createMemo(() =>
                        (props.currentPath?.length ?? 0) > 1 &&
                        props.currentPath![0] === i()
                            ? props.currentPath!.slice(1)
                            : undefined,
                    )
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
                                    [styles['outline-row--current']!]:
                                        isCurrent(),
                                }}
                                role="treeitem"
                                tabindex="-1"
                                aria-level={depth() + 1}
                                aria-expanded={
                                    hasChildren() ? open() : undefined
                                }
                                aria-current={
                                    isCurrent() ? 'location' : undefined
                                }
                                data-outline-depth={depth()}
                                onClick={jump}
                            >
                                <Label class={styles['outline-prefix']}>
                                    {outlinePrefix(
                                        ancestorsLast(),
                                        isLast(),
                                    ).trimEnd()}
                                </Label>
                                {/* Disclosure slot — one character cell wide for a parent (its
                                    chevron), zero width for a leaf (`--leaf`, OutlineTree.module.css)
                                    so a leaf's title sits one cell after its connector instead of
                                    three. A node's click is its own — it must not also jump. */}
                                <Text
                                    as="span"
                                    size="inherit"
                                    tone="inherit"
                                    weight="inherit"
                                    classList={{
                                        [styles['outline-disclosure']!]: true,
                                        [styles['outline-disclosure--leaf']!]:
                                            !hasChildren(),
                                    }}
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
                                                open()
                                                    ? `Collapse ${node.title}`
                                                    : `Expand ${node.title}`
                                            }
                                            aria-expanded={open()}
                                            class={
                                                styles['outline-disclosure-btn']
                                            }
                                            // Not a separate tab stop — the tree's roving
                                            // handler above reaches it with `.click()`.
                                            tabindex="-1"
                                            onClick={() => setOpen(o => !o)}
                                        />
                                    </Show>
                                </Text>
                                <Label fill class={styles['outline-title']}>
                                    {node.title}
                                </Label>
                                <Label
                                    tone="muted"
                                    class={styles['outline-page']}
                                >
                                    {node.page !== null
                                        ? `p.${node.page + 1}`
                                        : 'p.?'}
                                </Label>
                            </div>
                            <Show when={hasChildren() && open()}>
                                <OutlineTree
                                    nodes={node.children}
                                    onJump={props.onJump}
                                    currentPath={childCurrentPath()}
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
