// Visual spec for <MilkdownField> — the standalone TRUE-WYSIWYG rich-text field bound to a
// plain markdown string: bold renders bold, lists/headings render as blocks, wikilinks/tags
// become chips, no markdown symbols shown. A different engine from the already-storied
// `MarkdownField` (CodeMirror live-preview, per-token reveal) — this is genuine WYSIWYG, used
// e.g. for a kanban card's description (CardEditModal.tsx). The Milkdown/ProseMirror bridge is
// code-split (dynamic import), so the surface mounts asynchronously — expect a brief blank
// frame before content appears, same as the real app.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import MilkdownField from './MilkdownField'

const meta = {
    title: 'UI/MilkdownField',
    component: MilkdownField,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MilkdownField>

export default meta
type Story = StoryObj<typeof meta>

// MilkdownField owns its own chrome (FormControl's underline field + the prose theming in
// MilkdownField.module.css); the story only fixes a width — the same one MarkdownField.stories
// uses, so the two engines compare side by side. The hand-built rounded box this used to wrap it
// in is one no real caller produces.
const fieldWidthStyle = { width: '360px' } as const

function Controlled(props: {
    initial?: string
    autofocus?: boolean
    placeholder?: string
}) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={fieldWidthStyle}>
            <MilkdownField
                value={v()}
                onChange={setV}
                autofocus={props.autofocus}
                placeholder={props.placeholder}
            />
        </div>
    )
}

/** The editable ProseMirror node, once the code-split surface has mounted. */
async function editable(canvasElement: HTMLElement): Promise<HTMLElement> {
    let el: HTMLElement | null = null
    await waitFor(() => {
        el = canvasElement.querySelector('.bismuth-doc-milkdown')
        if (!el) throw new Error('milkdown surface not mounted yet')
    })
    return el!
}

/** Empty field — the surface mounts async, so this also covers the brief pre-mount blank
 *  frame every MilkdownField shows on first paint. */
export const Empty: Story = {
    render: () => <Controlled placeholder="Add a description…" />,
    // The field's OWN chrome: an underline (no box), transparent, the placeholder drawn in
    // --text-muted, and no browser focus ring on the editable.
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector(
            '[data-control="div"]',
        ) as HTMLElement
        const cs = getComputedStyle(host)
        expect(parseFloat(cs.borderBottomWidth)).toBeGreaterThan(0)
        expect(cs.borderTopWidth).toBe('0px')
        expect(cs.borderLeftWidth).toBe('0px')
        expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(host.getBoundingClientRect().height).toBeGreaterThanOrEqual(96)
        const el = await editable(canvasElement)
        expect(getComputedStyle(el).outlineStyle).toBe('none')
        const p = el.querySelector('p') as HTMLElement
        const before = getComputedStyle(p, '::before')
        expect(before.content).toBe('"Add a description…"')
    },
}

/** Seeded with block-level markdown: a heading, a bold/italic sentence, and a bullet list —
 *  all rendered as true WYSIWYG blocks (headings look like headings, no visible `#`/`**`),
 *  the thing that distinguishes this from the CodeMirror `MarkdownField`. */
export const Filled: Story = {
    render: () => (
        <Controlled
            initial={
                '## Ship the release\n\n**Bold** and _italic_ render as real formatting, not symbols.\n\n- Cut the changelog\n- Tag the build\n\n> Freeze the branch before tagging.\n'
            }
        />
    ),
    // Prose face (the one role both markdown fields share) and no browser focus ring.
    play: async ({ canvasElement }) => {
        const el = await editable(canvasElement)
        const cs = getComputedStyle(el)
        expect(cs.fontFamily).toContain('Plex Serif')
        expect(cs.fontFamily).not.toContain('Monaspace')
        expect(cs.outlineStyle).toBe('none')
        const h2 = el.querySelector('h2') as HTMLElement
        expect(h2).not.toBeNull()
        expect(parseFloat(getComputedStyle(h2).fontSize)).toBeGreaterThan(
            parseFloat(cs.fontSize),
        )
    },
}

/** Autofocused on mount (the field grabs the caret once the async surface finishes
 *  loading). */
export const Autofocused: Story = {
    render: () => (
        <Controlled initial="Focused once Milkdown mounts" autofocus />
    ),
    // Focus is drawn by the underline firming, never by a ring on the editable.
    play: async ({ canvasElement }) => {
        const el = await editable(canvasElement)
        await waitFor(() => expect(document.activeElement).toBe(el))
        expect(getComputedStyle(el).outlineStyle).toBe('none')
    },
}
