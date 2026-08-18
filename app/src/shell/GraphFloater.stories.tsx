// Visual spec for <GraphFloater> — the always-mounted Knowledge Graph wrapper, floated over
// whichever slot is currently active (sidebar mini-square, full main pane, or a tab's graph pane).
//
// WHY THIS FILE EXISTS: recorded BEFORE `.graph-floater`/`.docked` move from the global App.css
// into GraphFloater.module.css, which HASHES every class name — see the plan's THE RECIPE for why
// the recording order is load-bearing.
//
// `--sidebar-w`/`--sidebar-width` are set on the story wrapper so the docked `clip-path`'s
// `calc()` resolves to a real number — using the token's OWN default (266px, from App.tsx's
// `var(--sidebar-width, 266px)` usage), never an invented stand-in value.
//
// TWO STORIES: `Floating` — resting, full-size. `Docked` — the `clip-path` inset that shrinks the
// graph into the sidebar's mini-square; the only story reaching it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { GraphFloater } from './GraphFloater'

const noop = () => {}

const meta = {
    title: 'Shell/GraphFloater',
    component: GraphFloater,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof GraphFloater>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            position: 'relative',
            width: '480px',
            height: '320px',
            '--sidebar-w': '266px',
            '--sidebar-width': '266px',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

const Content = () => (
    <div
        style={{
            width: '100%',
            height: '100%',
            background:
                'repeating-linear-gradient(45deg, var(--border-soft), var(--border-soft) 8px, transparent 8px, transparent 16px)',
        }}
    />
)

/** Resting state: full-size, not docked. */
export const Floating: Story = {
    render: () => (
        <Wrap>
            <GraphFloater docked={false} ref={noop}>
                <Content />
            </GraphFloater>
        </Wrap>
    ),
}

/** `docked` — the sidebar clip-path inset, shrinking the graph into the mini-square. The only
 *  story reaching `.graph-floater.docked`. */
export const Docked: Story = {
    render: () => (
        <Wrap>
            <GraphFloater docked={true} ref={noop}>
                <Content />
            </GraphFloater>
        </Wrap>
    ),
}
