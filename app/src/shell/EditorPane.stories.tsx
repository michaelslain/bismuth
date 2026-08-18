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
//
// `.editor-pane { position: relative }` — its positioning context for the absolutely-positioned
// switcher bar — lives in palette/switcher.css, not here (see that file's header: it's loaded at
// boot because SwitcherBar is eagerly imported by App, so the context is always in place before a
// real switcher bar renders). WithSwitcher's stub stands in for SwitcherBar without importing what
// SwitcherBar imports, so without this the stub's `position: absolute` finds no positioned ancestor
// and escapes to the viewport — landing directly on top of the body stub below it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import '../palette/switcher.css'
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
 *  styling; this component only provides the slot. The stub's geometry AND stacking mirror the
 *  real `.switcher-bar` (palette/switcher.css): a left-docked, FULL-HEIGHT panel at `z-index: 20`
 *  — not a short top banner with no z-index. Two things compound without both corrections: (1) a
 *  top-banner-shaped stub happens to land at the same height as the short "[pane tree]" body
 *  text, and (2) `position: absolute` with no z-index is still stack-level 0 ("auto"), so CSS
 *  paints same-level positioned siblings in DOM order — `.editor-body` comes AFTER the switcher
 *  in EditorPane's own markup, so it paints ON TOP regardless of the switcher's own opacity. The
 *  real bar's explicit `z-index: 20` is what actually lifts it above the body; omitting it here
 *  let the two labels' glyphs interleave into an illegible smear no matter how opaque either
 *  background was. */
export const WithSwitcher: Story = {
    render: () => (
        <Wrap>
            <EditorPane
                banner={<></>}
                switcher={
                    <div
                        style={{
                            position: 'absolute',
                            top: '0',
                            left: '0',
                            bottom: '0',
                            width: 'min(560px, 45%)',
                            'z-index': 20,
                            padding: '16px',
                            background: 'var(--bg-elevated, var(--bg))',
                            'border-right': '1px solid var(--border-soft)',
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
