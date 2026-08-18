// Visual spec for <EditorPane> — the main editor column: optional update banner, the Cmd+O
// switcher bar, and the scrollable body.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.editor-pane`/`.editor-body` move from the global App.css
// into EditorPane.module.css. See the plan's THE RECIPE for why the recording order is
// load-bearing.
//
// THREE STORIES: `Default` — no banner, no switcher, just body content. `WithBanner` — a stub
// banner slot filled. `WithSwitcher` — a stub switcher bar, absolutely positioned over the body per
// the real `SwitcherBar`'s own styling (not this component's concern — it only provides the slot).
//
// EXPLICIT-HEIGHT WRAPPER: `.editor-pane` participates in the `.layout` CSS grid's row sizing in
// the real app; Storybook's canvas has no such context, so every story wraps in a fixed-height box.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { EditorPane } from './EditorPane'

const noop = () => {}

const meta = {
    title: 'Shell/EditorPane',
    component: EditorPane,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof EditorPane>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div style={{ height: '100vh', border: '1px solid var(--border-soft)' }}>
        {props.children as never}
    </div>
)

const Body = () => (
    <div
        style={{
            padding: '16px',
            color: 'var(--text-muted)',
        }}
    >
        [pane tree]
    </div>
)

/** No banner, no switcher — just body content. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <EditorPane banner={<></>} switcher={<></>} bodyRef={noop}>
                <Body />
            </EditorPane>
        </Wrap>
    ),
}

/** The update-banner slot filled — a full-width strip above the switcher/body. */
export const WithBanner: Story = {
    render: () => (
        <Wrap>
            <EditorPane
                banner={
                    <div
                        style={{
                            padding: '6px 12px',
                            background: 'var(--accent)',
                            color: 'var(--bg)',
                            'font-size': '12px',
                        }}
                    >
                        A new version is available — restart to update
                    </div>
                }
                switcher={<></>}
                bodyRef={noop}
            >
                <Body />
            </EditorPane>
        </Wrap>
    ),
}

/** The Cmd+O switcher slot filled — absolutely positioned over the body by the switcher's own
 *  styling; this component only provides the slot. */
export const WithSwitcher: Story = {
    render: () => (
        <Wrap>
            <EditorPane
                banner={<></>}
                switcher={
                    <div
                        style={{
                            position: 'absolute',
                            inset: '0 0 auto 0',
                            padding: '16px',
                            background: 'var(--bg-elevated, var(--bg))',
                            'border-bottom': '1px solid var(--border-soft)',
                        }}
                    >
                        [switcher bar]
                    </div>
                }
                bodyRef={noop}
            >
                <Body />
            </EditorPane>
        </Wrap>
    ),
}
