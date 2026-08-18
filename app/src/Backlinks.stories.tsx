// Visual spec for <Backlinks> — the "notes that link here" panel mounted below a note's prose
// (FileView.tsx). It fetches the whole vault graph on mount via api.graph() and derives rows
// with the pure deriveBacklinks() (backlinkGraph.ts); renders NOTHING when the open note has
// zero incoming wikilinks (a collapsed-empty component, by design).
//
// The shared fakeTransport (.storybook/preview.ts) has no GET /graph route (it covers /tree,
// /file, /rows — what most stories need), so this file layers ONE extra route on top of it,
// scoped to these stories only: GET /graph returns sampleGraphData() (app/src/ui/_graphFixtures.ts
// — the SAME real layout pipeline + fixture data every graph story uses), with a couple of extra
// real "link" edges added for the "several backlinks" story.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Backlinks } from './Backlinks'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { sampleGraphData } from './ui/_graphFixtures'
import type { Transport } from './api'
import type { GraphData } from '../../core/src/graph'

function graphTransport(graph: GraphData): Transport {
    const base = fakeTransport()
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/graph') return graph as unknown as T
            return base.getJson<T>(path)
        },
    }
}

const meta = {
    title: 'App/Backlinks',
    component: Backlinks,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Backlinks>

export default meta
type Story = StoryObj<typeof meta>

// sampleGraphData(6)'s note chain (Housing → Internship → Essay → Reading List → Project
// Roadmap → Meeting Notes) gives every note at most ONE incoming "link" edge, from its chain
// predecessor — e.g. "internship-1" is linked from "housing-0" alone.

/** One backlink. */
export const Default: Story = {
    render: () => {
        setTransport(graphTransport(sampleGraphData(6)))
        return <Backlinks path="internship-1.md" onOpen={() => {}} />
    },
}

/** Several notes linking to the same target — add real "link" edges from OTHER existing
 *  fixture notes onto "reading-list-3" (which already has one, from "essay-2") for the
 *  "many items" state. */
export const ManyBacklinks: Story = {
    render: () => {
        const graph = sampleGraphData(6)
        graph.edges.push(
            { from: 'housing-0', to: 'reading-list-3', kind: 'link' },
            { from: 'meeting-notes-5', to: 'reading-list-3', kind: 'link' },
        )
        setTransport(graphTransport(graph))
        return <Backlinks path="reading-list-3.md" onOpen={() => {}} />
    },
}
