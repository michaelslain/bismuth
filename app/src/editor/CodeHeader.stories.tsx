// Visual spec for <CodeHeader> — the header CodeMirror's live-preview shows in place of a
// code block's opening ```lang fence when the cursor is outside the block (livePreview.ts,
// mounted as a widget). Its real chrome (flex row, dim lang label, icon-only copy button)
// lives as CodeMirror `EditorView.baseTheme()` rules (livePreview.ts, the
// `.cm-code-header`/`.cm-code-lang`/`.cm-code-copy` block) — CSS that CodeMirror only
// injects for a live EditorView instance, not a stylesheet we can import here. The <style>
// below reproduces those rules verbatim (same selectors, same var() tokens, no invented
// values) so the component's own class names pick up their real styling instead of an
// approximation — the same "recreate the real host chrome" move Modal.stories.tsx uses for
// its DialogPanel wrapper, just via a literal CSS copy instead of an inline style object.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CodeHeader } from './CodeHeader'

const meta = {
    title: 'Editor/CodeHeader',
    component: CodeHeader,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeHeader>

export default meta
type Story = StoryObj<typeof meta>

// Verbatim from livePreview.ts's EditorView.baseTheme() (the widget's real, only styling).
const CODE_HEADER_CSS = `
  .cm-code-header {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    font-size: var(--fs-micro);
  }
  .cm-code-lang {
    font-family: var(--ui-font-stack);
    color: color-mix(in srgb, var(--fg) 42%, transparent);
    letter-spacing: 0.04em;
  }
  .cm-code-copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--fg) 45%, transparent);
    padding: 2px;
    opacity: 0.8;
    transition: color 120ms, opacity 120ms;
  }
  .cm-code-copy:hover { color: var(--accent); opacity: 1; }
`

// The opening-fence row this widget rides sits inside `.cm-block-top`'s own padded band —
// approximated here as a plain padded strip, since that band's fuller styling is unrelated
// to CodeHeader itself.
const rowStyle = {
    width: '360px',
    padding: '6px 10px',
    background: 'var(--surface-1)',
    border: '1px solid var(--border)',
    'border-radius': '6px',
} as const

/** A TypeScript block's header: dim "typescript" label + copy button. */
export const Default: Story = {
    render: () => (
        <>
            <style>{CODE_HEADER_CSS}</style>
            <div style={rowStyle}>
                <CodeHeader lang="typescript" body={'export const x = 1;\n'} />
            </div>
        </>
    ),
}

/** No language on the fence (a bare ``` block) — falls back to "text" rather than an
 *  empty label. */
export const NoLanguage: Story = {
    render: () => (
        <>
            <style>{CODE_HEADER_CSS}</style>
            <div style={rowStyle}>
                <CodeHeader lang="" body={'echo hello\n'} />
            </div>
        </>
    ),
}
