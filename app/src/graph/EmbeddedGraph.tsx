// app/src/graph/EmbeddedGraph.tsx
//
// The rendered face of a ```graph note block (app/src/editor/graphBlock.ts): parses the
// block's DSL body (core/src/graphBlock.ts), lays the graph out with the SAME pure layout
// the knowledge graph uses (core/src/layout.ts), and renders it with the SAME renderer the
// knowledge graph uses (AsciiGraphRenderer, through the GraphRenderer seam) — no second renderer.
//
// The renderer is held as a `GraphRenderer`, not as the concrete class: this block only ever
// needs the seam, and typing it that way is what let CanvasGraphRenderer be deleted.
//
// Two renderer contracts this block deliberately diverges from, both because a hand-authored
// diagram is not a knowledge graph:
//   • labelEveryNode — the file-label ladder (labelSelection.ts) is zoom-driven and shows NOTHING
//     at fit, which is where a block opens. A diagram's labels are its content, so it opts out of
//     the ladder entirely. (The old `graphLabelHubCount: 9999` was an attempt at this that could
//     never have worked — see GraphConfig.labelEveryNode's doc.)
//   • showLodMasses is left off. A ` ```graph ` block carries no communities (layoutGraphData
//     in embeddedGraphRender.ts explains why), so there is nothing to aggregate and every node
//     draws as itself at every zoom stop.
//
// The round-trip: every edit tool below mutates the parsed spec through the pure helpers
// and hands the CANONICAL serialized markdown to props.onChange, which the widget writes
// back into the fence as an ordinary editor transaction. The doc change re-renders the
// block from that markdown — so what you see is always exactly what the markdown says.
//
// Edit affordances (v1 — a coherent, honest subset):
//   SELECT   click a node → rename its id / set its label / delete it
//   CONNECT  click two nodes → add an edge between them (or remove the existing one);
//            the →/— toggle picks directed vs undirected for new edges
//   ERASE    click a node → delete it and its edges
//   + NODE   append a fresh node
//   SOURCE   reveal the raw fence for hand-editing (collapses when the caret leaves)
// Node drag-repositioning is intentionally NOT in: layout is computed (deterministically)
// from the structure, so positions aren't part of the markdown model.
//
// layoutGraphData/embeddedGraphConfig — the two pure units this component feeds to the
// renderer — live in the sibling embeddedGraphRender.ts, not here: bun test can't import
// anything from a .tsx file in this repo (see that file's header for why), and EmbeddedGraph.
// test.ts needs to drive them directly against a real AsciiGraphRenderer.

import {
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    Show,
    For,
} from 'solid-js'
import { AsciiGraphRenderer } from './AsciiGraphRenderer'
import type { GraphRenderer } from './graphRenderer'
import { layoutGraphData, embeddedGraphConfig } from './embeddedGraphRender'
import {
    parseGraphBlock,
    serializeGraphBlock,
    addNode,
    removeNode,
    renameNode,
    setNodeLabel,
    hasEdgeBetween,
    addEdge,
    removeEdgesBetween,
    type GraphBlockSpec,
} from '../../../core/src/graphBlock'
import { settings } from '../settings'
import { resolveAppearance } from '../themes'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import { IconButton } from '../ui/IconButton'
import { IconTextButton } from '../ui/IconTextButton'
import { Icon } from '../icons/Icon'
import styles from './EmbeddedGraph.module.css'

type Tool = 'select' | 'connect' | 'erase'

// Tool/arrow/dimension choices are module-level so they survive the widget remount that
// every write-back causes (the fence's source changes → a fresh widget renders the new
// markdown). Shared across blocks, like the graph view's 2D/3D toggle.
const [tool, setTool] = createSignal<Tool>('select')
const [directed, setDirected] = createSignal(true)
const [dim, setDim] = createSignal<'2d' | '3d'>('2d')

export function EmbeddedGraph(props: {
    source: string
    onReveal: () => void
    onChange: (body: string) => void
}) {
    // The widget remounts whenever the source changes (its eq() compares source), so the
    // body is static for this component instance — parse + lay out once.
    const { spec, errors } = parseGraphBlock(props.source)
    const hasErrors = errors.length > 0
    const data = layoutGraphData(spec)

    const [pending, setPending] = createSignal<string | null>(null) // connect-mode first endpoint
    const [selected, setSelected] = createSignal<string | null>(null)
    const [editId, setEditId] = createSignal('')
    const [editLabel, setEditLabel] = createSignal('')

    const renderer: GraphRenderer = new AsciiGraphRenderer()
    let host!: HTMLDivElement

    // Serialize a mutated spec back into the fence. The widget no-ops identical bodies, so
    // an ineffective edit (e.g. an invalid rename) simply leaves the document untouched.
    const commit = (next: GraphBlockSpec) => {
        if (hasErrors) return // serializing a partial parse would DROP the bad lines
        props.onChange(serializeGraphBlock(next))
    }

    const selectNode = (id: string | null) => {
        setSelected(id)
        const n = id ? spec.nodes.find(n => n.id === id) : undefined
        setEditId(n?.id ?? '')
        setEditLabel(n?.label ?? '')
        if (id) renderer.highlightNodes([id])
        else renderer.clearHighlight()
    }

    const onNodeClick = (id: string) => {
        if (hasErrors) return
        const t = tool()
        if (t === 'erase') {
            commit(removeNode(spec, id))
            return
        }
        if (t === 'connect') {
            const p = pending()
            if (!p) {
                setPending(id)
                renderer.highlightNodes([id])
                return
            }
            if (p === id) {
                setPending(null)
                renderer.clearHighlight()
                return
            }
            commit(
                hasEdgeBetween(spec, p, id)
                    ? removeEdgesBetween(spec, p, id)
                    : addEdge(spec, p, id, directed()),
            )
            return
        }
        selectNode(selected() === id ? null : id)
    }

    const applyEdit = () => {
        const id = selected()
        if (!id) return
        commit(renameNode(setNodeLabel(spec, id, editLabel()), id, editId()))
    }

    onMount(() => {
        renderer.mount(host, onNodeClick)
        renderer.onHighlightCleared = () => {
            setSelected(null)
            setPending(null)
        }
        renderer.render(data)
        // The renderer preventDefaults wheel (zoom). Fine for a full-pane graph, but an
        // INLINE block must not hijack note scrolling — so plain scroll passes through
        // (stopPropagation in the capture phase keeps it from the renderer's viewport
        // listener) and only Mod+scroll (or a trackpad pinch, which sets ctrlKey) zooms.
        const wheelGate = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) e.stopPropagation()
        }
        host.addEventListener('wheel', wheelGate, { capture: true })
        onCleanup(() =>
            host.removeEventListener('wheel', wheelGate, { capture: true }),
        )
    })
    onCleanup(() => renderer.destroy())

    // Live theme + graph settings (see embeddedGraphConfig in embeddedGraphRender.ts for the
    // derivation + the two deliberate divergences from the knowledge graph's contract).
    createEffect(() => {
        renderer.setConfig(
            embeddedGraphConfig(
                settings.graph,
                resolveAppearance(settings.appearance),
                dim(),
            ),
        )
    })

    const hint = () => {
        if (hasErrors) return 'Fix the source to enable graph editing.'
        if (spec.nodes.length === 0)
            return 'Empty graph — press + NODE to start.'
        switch (tool()) {
            case 'connect':
                return pending()
                    ? `Click another node to ${directed() ? 'link' : 'join'} it with "${pending()}" (linked pair → unlink).`
                    : 'Click two nodes to add an edge — clicking an already-linked pair removes it.'
            case 'erase':
                return 'Click a node to delete it and its edges.'
            default:
                return 'Click a node to rename / relabel / delete it. Drag orbits, Mod+scroll zooms.'
        }
    }

    return (
        <div class={styles['graph-block-root']}>
            <div class={styles['graph-block-toolbar']}>
                <Show when={!hasErrors}>
                    <SegmentedToggle<Tool>
                        value={tool()}
                        onChange={t => {
                            setTool(t)
                            setPending(null)
                            selectNode(null)
                        }}
                        size="sm"
                        options={[
                            {
                                id: 'select',
                                title: 'Select — click a node to edit it',
                                label: (
                                    <>
                                        <Icon value="Pencil" />
                                        <span class="btn-label">SELECT</span>
                                    </>
                                ),
                            },
                            {
                                id: 'connect',
                                title: 'Connect — click two nodes to link / unlink',
                                label: (
                                    <>
                                        <Icon value="Link" />
                                        <span class="btn-label">CONNECT</span>
                                    </>
                                ),
                            },
                            {
                                id: 'erase',
                                title: 'Erase — click a node to delete it',
                                label: (
                                    <>
                                        <Icon value="Eraser" />
                                        <span class="btn-label">ERASE</span>
                                    </>
                                ),
                            },
                        ]}
                    />
                    <Show when={tool() === 'connect'}>
                        <SegmentedToggle<'dir' | 'undir'>
                            value={directed() ? 'dir' : 'undir'}
                            onChange={v => setDirected(v === 'dir')}
                            size="sm"
                            options={[
                                {
                                    id: 'dir',
                                    title: 'New edges are directed (->)',
                                    label: <Icon value="ArrowRight" />,
                                },
                                {
                                    id: 'undir',
                                    title: 'New edges are undirected (--)',
                                    label: <Icon value="Minus" />,
                                },
                            ]}
                        />
                    </Show>
                    <IconTextButton
                        icon="Plus"
                        size="sm"
                        onClick={() => commit(addNode(spec).spec)}
                    >
                        NODE
                    </IconTextButton>
                </Show>
                <span class={styles['graph-block-spacer']} />
                <SegmentedToggle<'2d' | '3d'>
                    value={dim()}
                    onChange={setDim}
                    size="sm"
                    options={[
                        {
                            id: '2d',
                            title: 'Flat layout',
                            label: <Icon value="Square" />,
                        },
                        {
                            id: '3d',
                            title: 'Orbit layout',
                            label: <Icon value="Box" />,
                        },
                    ]}
                />
                <IconButton
                    icon="Code"
                    label="Edit graph source"
                    size="sm"
                    onClick={props.onReveal}
                />
            </div>
            <Show when={hasErrors}>
                <div class={styles['graph-block-errors']}>
                    <For each={errors}>
                        {e => (
                            <div>
                                line {e.line}: {e.message}
                            </div>
                        )}
                    </For>
                </div>
            </Show>
            <div class={styles['graph-block-canvas']} ref={host} />
            <Show when={!hasErrors && tool() === 'select' && selected()}>
                <div class={styles['graph-block-edit']}>
                    {/* `for`/`id` pairing, not just visual adjacency. These two labels sat NEXT TO
                        their inputs with no programmatic association at all, so a screen reader
                        announced "edit text" twice with no name — a clean WCAG 1.3.1 / 4.1.2
                        failure, and the only one of its kind in the app where a real <label>
                        element was already present and simply not wired up. The ids are static
                        because this block renders at most once per editor selection. */}
                    <label
                        class={styles['graph-block-edit-label']}
                        for="graph-block-edit-id"
                    >
                        id
                    </label>
                    <input
                        id="graph-block-edit-id"
                        class={`ui-input ${styles['graph-block-input']}`}
                        value={editId()}
                        onInput={e => setEditId(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') applyEdit()
                        }}
                    />
                    <label
                        class={styles['graph-block-edit-label']}
                        for="graph-block-edit-label"
                    >
                        label
                    </label>
                    <input
                        id="graph-block-edit-label"
                        class={`ui-input ${styles['graph-block-input']}`}
                        value={editLabel()}
                        placeholder={selected() ?? ''}
                        onInput={e => setEditLabel(e.currentTarget.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') applyEdit()
                        }}
                    />
                    <IconTextButton icon="Check" size="sm" onClick={applyEdit}>
                        APPLY
                    </IconTextButton>
                    <IconTextButton
                        icon="Trash2"
                        size="sm"
                        danger
                        onClick={() => commit(removeNode(spec, selected()!))}
                    >
                        DELETE
                    </IconTextButton>
                </div>
            </Show>
            <div class={styles['graph-block-footer']}>
                <span>{hint()}</span>
                <span class={styles['graph-block-spacer']} />
                <span>
                    {spec.nodes.length} nodes · {spec.edges.length} edges
                </span>
            </div>
        </div>
    )
}
