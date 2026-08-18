// Visual spec for <EmbeddedGraph> — the rendered face of a ```graph note block. It takes a
// plain `source: string` (the block's raw DSL body, NOT including the fence markers), parses
// it with core/src/graphBlock.ts's parseGraphBlock, and lays it out CLIENT-SIDE with the same
// pure layout the knowledge graph itself uses (core/src/layout.ts's computeLayout, via the
// sibling embeddedGraphRender.ts) — no network call, no backend round-trip, nothing to fake.
//
// `onReveal`/`onChange` are the widget's own edit affordances (toggle the raw-source view;
// write a mutated spec back into the note's fence via a doc transaction). Both are no-ops
// here — there's no fence for a story to write back into, and the toolbar/canvas render
// identically either way.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { EmbeddedGraph } from './EmbeddedGraph'

const meta = {
    title: 'Graph/EmbeddedGraph',
    component: EmbeddedGraph,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof EmbeddedGraph>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A small directed chain plus one undirected edge — the DSL's everyday shape: `id: label`
 *  node lines, `a -> b` / `a -- b` edge lines (endpoints declared implicitly on first mention). */
const SIMPLE_SOURCE = `alpha: Alpha
beta: Beta
gamma: Gamma
alpha -> beta
beta -> gamma
gamma -- alpha
`

export const Default: Story = {
    render: () => (
        <EmbeddedGraph source={SIMPLE_SOURCE} onReveal={noop} onChange={noop} />
    ),
}

/** Labeled edges (`a -> b: label`) mixing directed and undirected links in one diagram — the
 *  block's full edge-line grammar. */
const LABELED_SOURCE = `alice: Alice
bob: Bob
carol: Carol
dave: Dave
alice -> bob: manages
bob -> carol: mentors
carol -- dave: peer of
dave -> alice
`

export const LabeledEdges: Story = {
    render: () => (
        <EmbeddedGraph
            source={LABELED_SOURCE}
            onReveal={noop}
            onChange={noop}
        />
    ),
}

/**
 * Malformed source: a dangling arrow with no right-hand token, then an unterminated quoted
 * token — mirrors core/test/graphBlock.test.ts's "bad statements are reported with 1-based
 * line numbers and skipped" fixture. The parser reports each bad line and skips it rather
 * than dropping the whole diagram, so the well-formed nodes (`alpha`, `beta`, `ok`) still
 * parse and render; the edit toolbar collapses to just the 2D/3D toggle + source button
 * (SELECT/CONNECT/ERASE/+NODE all require a clean parse — see EmbeddedGraph.tsx's `hasErrors`
 * guard) while the error banner lists what's wrong.
 */
const ERROR_SOURCE = `alpha -> beta
alpha ->
"unterminated
ok
`

export const ParseErrors: Story = {
    render: () => (
        <EmbeddedGraph source={ERROR_SOURCE} onReveal={noop} onChange={noop} />
    ),
}
