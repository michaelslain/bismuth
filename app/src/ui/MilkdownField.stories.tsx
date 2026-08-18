// Visual spec for <MilkdownField> — the standalone TRUE-WYSIWYG rich-text field bound to a
// plain markdown string (the SAME Milkdown surface the note block-editor uses): bold renders
// bold, lists/headings render as blocks, wikilinks/tags become chips, no markdown symbols
// shown. A different engine from the already-storied `MarkdownField` (CodeMirror live-
// preview, per-token reveal) — this is genuine block-mode WYSIWYG, used e.g. for a kanban
// card's description (CardEditModal.tsx). The Milkdown/ProseMirror bridge is code-split
// (dynamic import), so the surface mounts asynchronously — expect a brief blank frame before
// content appears, same as the real app.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { MilkdownField } from './MilkdownField'

const meta = {
    title: 'UI/MilkdownField',
    component: MilkdownField,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MilkdownField>

export default meta
type Story = StoryObj<typeof meta>

// The host owns the visible box (border/background/padding/min-height); MilkdownField itself
// is chromeless apart from its own imported BlockEditor.css. Mirrors MarkdownField.stories's
// fieldBoxStyle so the two engines are easy to compare side by side in the sidebar.
const fieldBoxStyle = {
    width: '360px',
    'min-height': '110px',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    'border-radius': '8px',
    background: 'var(--surface-1)',
} as const

function Controlled(props: { initial?: string; autofocus?: boolean }) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={fieldBoxStyle}>
            <MilkdownField
                value={v()}
                onChange={setV}
                autofocus={props.autofocus}
            />
        </div>
    )
}

/** Empty field — the surface mounts async, so this also covers the brief pre-mount blank
 *  frame every MilkdownField shows on first paint. */
export const Empty: Story = {
    render: () => <Controlled />,
}

/** Seeded with block-level markdown: a heading, a bold/italic sentence, and a bullet list —
 *  all rendered as true WYSIWYG blocks (headings look like headings, no visible `#`/`**`),
 *  the thing that distinguishes this from the CodeMirror `MarkdownField`. */
export const Filled: Story = {
    render: () => (
        <Controlled
            initial={
                '## Ship the release\n\n**Bold** and _italic_ render as real formatting, not symbols.\n\n- Cut the changelog\n- Tag the build\n'
            }
        />
    ),
}

/** Autofocused on mount (the field grabs the caret once the async surface finishes
 *  loading). */
export const Autofocused: Story = {
    render: () => (
        <Controlled initial="Focused once Milkdown mounts" autofocus />
    ),
}
