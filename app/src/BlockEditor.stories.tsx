// Visual spec for <BlockEditor> — the Milkdown (ProseMirror) TRUE-WYSIWYG note surface, the
// sibling of the CodeMirror `Editor`: `editor.defaultMode` picks one or the other, but both
// share the EXACT same props contract ({ path, initialText, onSaved, noteNames, tagNames }),
// so every story below supplies all five directly rather than routing through FileView.
//
// Autosave is a debounced side effect of EDITING (scheduleSave, fired from onPlainInput/commit),
// never mount-time IO — the component's initial parse comes entirely from `initialText`. BUT a
// SEPARATE effect (the SSE external-change reconcile) unconditionally fires once on mount
// regardless of `initialText`, and it calls `api.read(path)` to compare against disk. The global
// fakeTransport from `.storybook/preview.ts` has no entry for these stories' paths, and its
// `getText` resolves an unseeded path to `""` rather than throwing — so that first reconcile read
// silently succeeds with an empty string, and the effect treats it as a genuine external change,
// re-parsing "" and STOMPING the freshly-loaded blocks back to empty. So every story below layers
// its own `setTransport(fakeTransport({ files: { [path]: MARKDOWN } }))` (PreviewView.stories.tsx's
// pattern) so that read-back matches what's already loaded and the reconcile is a no-op. The other
// mount-time network call is a defensive `normalizeFrontmatterSpacing` re-write, and only when the
// document HAS frontmatter that needs reformatting; none of the fixtures below carry frontmatter,
// so it never fires.
//
// Milkdown bridge risk: `./blocks/milkdownEditor.ts`'s `createBlockEditor` is the SAME module
// (and the same `@milkdown/core` + `@milkdown/preset-commonmark` plugin stack) already proven to
// mount inside Storybook by `ui/MilkdownField.stories.tsx` (via the sibling `createDocEditor`
// factory in that file) — so the core WYSIWYG surface (bold/italic/headings/lists/wikilink+tag
// atoms) is expected to render for real, not just typecheck. BlockEditor layers more on top of
// that shared bridge — viewport-lazy mounting (IntersectionObserver), the slash menu, the
// selection-anchored FormatBar, drag-reorder — which is new surface area this file is the first
// to exercise; report anything that doesn't come up rendered.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { BlockEditor } from './BlockEditor'
import type { NoteCandidate } from './editor/wikilink'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { expectProseFace, expectEditorFace, expectEditorSize, expectBoundToEditorFont } from './ui/_fontFace'

const meta = {
    title: 'App/BlockEditor',
    component: BlockEditor,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BlockEditor>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// `.block-editor` (BlockEditor.module.css) is `height: 100%; overflow: auto` — it expects a parent with
// a resolved height, same as it gets from the app's pane-content column. Storybook's fullscreen
// layout doesn't itself chain a height, so every story wraps in an explicit 100vh box (the same
// idiom `EmptyPane.stories.tsx` uses for its own fixed-height wrapper).
const hostStyle = { height: '100vh' } as const

// A resolvable wikilink target + a couple of decoys, so `[[Related Note]]` in the fixture below
// renders as a live chip rather than an unresolved-looking one.
const noteNames = (): NoteCandidate[] => [
    { label: 'Related Note', path: 'Related Note.md', folder: 'reading' },
    { label: 'Project Notes', path: 'Project Notes.md' },
    { label: 'Team Roster', path: 'team/Team Roster.md', folder: 'team' },
]
const tagNames = (): string[] => ['project', 'planning', 'draft']

// Real prose covering every element the task asked for: an H1 + H2 heading, a bold/italic
// sentence carrying a wikilink AND a tag (both should render as atom chips, not literal
// brackets/hashes), a bullet list, two task lines (one checked), a plain markdown link, and a
// fenced code block. Built by concatenation (not a template literal) so the ``` fence can appear
// literally without escaping.
const DEFAULT_MARKDOWN =
    '# Project Notes\n\n' +
    'This paragraph has **bold text**, *italic text*, a [[Related Note]] wikilink, and a #project tag.\n\n' +
    '## Next steps\n\n' +
    '- Draft the outline\n' +
    '- Share with the team\n' +
    '- Collect feedback\n\n' +
    '- [ ] Ship the first draft\n' +
    '- [x] Set up the outline doc\n\n' +
    'Read more in the [Bismuth docs](https://bismuth.example.com/docs).\n\n' +
    '```ts\n' +
    'const ready = true;\n' +
    '```\n'

/** The full element set: headings, bold/italic, a wikilink + tag chip, a bullet list, an open
 *  and a checked task, a markdown link, and a fenced code block (stays a monospace textarea —
 *  code is the one rich-text type that does NOT route through Milkdown). */
export const Default: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Project Notes.md': DEFAULT_MARKDOWN } }),
        )
        return (
            <div style={hostStyle}>
                <BlockEditor
                    path="Project Notes.md"
                    initialText={DEFAULT_MARKDOWN}
                    onSaved={noop}
                    noteNames={noteNames}
                    tagNames={tagNames}
                />
            </div>
        )
    },
}

/** A brand-new, empty note — the "Start writing…" affordance shown when `blocks.length === 0`. */
export const Empty: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Untitled.md': '' } }))
        return (
            <div style={hostStyle}>
                <BlockEditor
                    path="Untitled.md"
                    initialText=""
                    onSaved={noop}
                    noteNames={noteNames}
                    tagNames={tagNames}
                />
            </div>
        )
    },
}

// A GFM table is an OPAQUE block (blockModel.ts never breaks it into cells): it renders read-only
// via the shared renderNoteBody markdown engine (the same one notes/cards/export use), not
// through Milkdown, with a click-to-edit-raw affordance. Exercises the RenderedBlock path
// alongside the rich-text ones above.
const TABLE_MARKDOWN =
    '# Team Roster\n\n' +
    '| Name | Role | Status |\n' +
    '| --- | --- | --- |\n' +
    '| Ada | Engineer | Active |\n' +
    '| Grace | Design | Active |\n' +
    '| Alan | Research | On leave |\n\n' +
    'Click the table to edit its raw markdown source.\n'

/** A document with a GFM table — the read-only RenderedBlock path (click-to-edit-raw), not the
 *  Milkdown surface. TABLES ARE PROSE here too (2026-08-31, matching Editor.css): a table is the
 *  note's own content, not chrome, so it must render in the same face as the paragraph around it.
 *  Asserted against `--prose-font` rather than a literal family name — see Editor.stories.tsx's
 *  MixedTypography for the same pattern; a hardcoded stack would pass while the app rendered
 *  something else entirely. */
export const WithTable: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Team Roster.md': TABLE_MARKDOWN } }),
        )
        return (
            <div style={hostStyle}>
                <BlockEditor
                    path="Team Roster.md"
                    initialText={TABLE_MARKDOWN}
                    onSaved={noop}
                    noteNames={noteNames}
                    tagNames={tagNames}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cell = canvasElement.querySelector('td, th') as HTMLElement
        await expect(cell).not.toBeNull()
        expectProseFace(cell)
    },
}

const TAG_MARKDOWN = 'A WYSIWYG tag: #project, and #planning inline in prose.\n'

/** #tags read in the EDITOR's mono face at the editor size, matching .cm-tag / the chat
 *  transcript / the in-table chip (the user's call, 2026-09-03: "they should all be the same,
 *  monaspace"). Before this change the chip declared NO font-family at all and inherited the
 *  surrounding CMU Serif prose — a serif tag in an otherwise all-mono register. */
export const TagTypography: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Tag Typography.md': TAG_MARKDOWN } }),
        )
        return (
            <div style={hostStyle}>
                <BlockEditor
                    path="Tag Typography.md"
                    initialText={TAG_MARKDOWN}
                    onSaved={noop}
                    noteNames={noteNames}
                    tagNames={tagNames}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.bismuth-tag')) {
                throw new Error('tag chip not rendered yet')
            }
            return true
        })
        const tags = canvasElement.querySelectorAll<HTMLElement>('.bismuth-tag')
        await expect(tags.length).toBeGreaterThan(0)
        for (const el of tags) {
            // Before this change the chip declared NO family at all and inherited the
            // surrounding CMU Serif prose — a serif tag in an otherwise all-mono register.
            // This surface would already catch a plain revert (serif is visibly not Monaspace
            // Xenon), but expectBoundToEditorFont runs anyway so all three surfaces share one
            // standard rather than two of them getting the weaker check.
            expectEditorFace(el)
            expectEditorSize(el)
            expectBoundToEditorFont(el)
        }
    },
}
