// Visual spec for <Editor> — the CodeMirror 6 note surface: live preview, wikilink/tag/slash/
// `:emoji:` autocomplete, `query` blocks, embeds, editable GFM tables, find bar, KaTeX, Harper
// spell+grammar. This file does NOT modify `Editor.tsx` — every story below exercises the real,
// unmodified component. Its props (`path`, `initialText`, `onSaved`, `noteNames`, `memoryNames`,
// `tagNames`) are self-contained and autosave is debounce-on-change (not mount-time IO), so it
// renders from `initialText` alone: no live vault, just the in-memory `fakeTransport`
// `.storybook/preview.ts` installs globally (autosave's `api.read`/`api.writeChecked` land on
// that; anything it doesn't implement — e.g. `GET /templates`, `GET /schema` — the corresponding
// Editor.tsx call already wraps in a `.catch(() => {})`, so it degrades to "no candidates" instead
// of crashing the story).
//
// If a story below renders blank or visibly wrong, that is real signal about the extension stack
// under Storybook, not a story-authoring bug to quietly work around — report it instead of
// papering over it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import { Editor } from './Editor'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'

const meta = {
    title: 'Editor/Editor',
    component: Editor,
    // Editor fills its pane edge-to-edge in the real app (no card chrome around it) — same
    // reasoning as GraphView.stories.tsx's `fullscreen`, not TableView's `padded`.
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Editor>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// GraphView.stories.tsx / Calendar/MonthView.stories.tsx's own notes on this).
const STORY_H = '700px'

/** A few note titles so `[[Another Note]]` in DEFAULT_TEXT resolves to a real vault path
 *  (wikilink completion + click-to-navigate both key off this list). */
const NOTE_NAMES: NoteCandidate[] = [
    { label: 'Another Note', path: 'Another Note.md' },
    { label: 'Project Plan', path: 'projects/Project Plan.md' },
    { label: 'Reading List', path: 'reading/Reading List.md' },
]
/** One memory candidate so a `??slug` reference has something to resolve against. Unused by
 *  DEFAULT_TEXT (no memory reference in it) but exercises the required prop with real shape. */
const MEMORY_NAMES: MemoryCandidate[] = [
    { label: 'daily-standup', slug: 'daily-standup' },
]
const TAG_NAMES = ['demo', 'storybook', 'editor']

// Built with an array + join (not one big template literal) so the fenced ```js block's own
// backticks never collide with the outer TS string syntax.
const DEFAULT_TEXT = [
    '---',
    'tags: [demo, storybook]',
    'status: active',
    '---',
    '',
    '# Editor Demo',
    '',
    'A tour of the note surface: **live preview**, a wikilink to [[Another Note]], and a #demo tag.',
    '',
    '## Tasks',
    '',
    '- [ ] Write the harness',
    '- [x] Read Editor.tsx',
    '',
    '## Code',
    '',
    '```js',
    'console.log("hello from a fenced code block");',
    '```',
    '',
    '## Math',
    '',
    'Inline energy: $E = mc^2$',
    '',
    '$$',
    '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
    '$$',
    '',
].join('\n')

/** The full note-editing extension stack: frontmatter (yamlSchema), a heading + prose, a
 *  wikilink, a tag, an open + a done task (taskFold), a fenced code block (syntax highlighting),
 *  and both inline + block KaTeX math. Harper spellcheck runs too (editor.spellcheck defaults
 *  true) — its WASM worker load depends on the Storybook Vite dev server picking up the app's
 *  `vite.config.ts` `optimizeDeps.exclude: ["harper.js"]` (Storybook's Vite builder auto-loads
 *  and merges the project's own `vite.config.ts` — confirmed by reading
 *  `@storybook/builder-vite`'s `commonConfig`, which calls Vite's `loadConfigFromFile` rooted at
 *  `app/`), so this is the story to check first if spelling squiggles don't appear.
 *
 *  MUST seed the fake transport's file at `path` with the SAME text as `initialText`: Editor.tsx
 *  mounts with `lastChange()`'s initial `{version: 0, paths: []}` already "dirty", so its SSE-
 *  reconcile effect (only real callers ever hit this — they always pass already-fetched disk
 *  content, so it's normally a no-op) fires on mount and re-reads `GET /file?path=...`. An
 *  unseeded fakeTransport answers a missing path with `""` (see `_fakeTransport.ts`'s
 *  `getText`), which the effect reads as a genuine external edit and reconciles the buffer DOWN
 *  TO EMPTY milliseconds after mount — the story renders only the note-title widget over a
 *  blank body. Seeding the same text at the same path makes `current === onDisk`, so the
 *  reconcile is the no-op every real caller already gets for free. */
export const Default: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Editor Demo.md': DEFAULT_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Editor Demo.md"
                    initialText={DEFAULT_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
}

/** A brand-new, never-saved note: `initialText: ""` (still defined, so Editor skips its
 *  `api.read` fallback path) — just the note-title widget over an empty body. No fakeTransport
 *  seeding needed here (see the Default story's comment on WHY that matters elsewhere): an
 *  unseeded path already reads back as `""`, matching `initialText`, so the mount-time SSE-
 *  reconcile effect finds `current === onDisk` and no-ops — same as a real new note. */
export const NewNote: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <Editor
                path="Untitled.md"
                initialText=""
                onSaved={noop}
                noteNames={() => NOTE_NAMES}
                memoryNames={() => MEMORY_NAMES}
                tagNames={() => TAG_NAMES}
            />
        </div>
    ),
}

// `.settings` (SETTINGS_FILE, app/src/tabIds.ts) is the ONE path `isSettingsBuffer()` matches —
// the only vault-root file that opens through the schema-validated app-settings branch rather
// than a plain `.yaml` note. A handful of real top-level keys so settingsCompletion/yamlSchema
// have something to validate against SETTINGS_SCHEMA.
const SETTINGS_TEXT = [
    'appearance:',
    '  theme: ink',
    'editor:',
    '  livePreview: true',
    '  spellcheck: true',
    'vault:',
    '  backupOnSave: false',
    '',
].join('\n')

/** The OTHER major branch of Editor.tsx's extension stack: `path === ".settings"` routes through
 *  `isYaml` — YAML language + syntax highlighting (not markdown), a 2-space indent, a line-number
 *  gutter (config files always show one), `yamlSchema` in "settings" mode, and
 *  `settingsCompletion` — instead of live preview / wikilinks / Harper / KaTeX. No note-editing
 *  extension from the Default story above applies here.
 *
 *  Same fakeTransport seeding as Default, and for the same reason: without it the mount-time
 *  SSE-reconcile effect reads back `""` for `.settings` and reconciles the buffer empty. */
export const SettingsYaml: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { '.settings': SETTINGS_TEXT } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path=".settings"
                    initialText={SETTINGS_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
}

// ── Stories added for the typography + callout work (2026-08-31) ───────────────────────────────
// Each of these exists because a bug shipped that a story would have caught, and each one asserts
// the specific number or behaviour that was wrong. They are written as `play` assertions rather
// than pure screenshots because every defect here was a COMPUTED VALUE (a font size, a line
// height) or an INTERACTION (double-click to reveal) — things a picture shows only if you already
// know what to look for.

const MIXED_TEXT = `---
tags: [demo]
---

# Heading One

Prose body with an \`inline code span\` inside it, and enough words to run the measure.

\`\`\`yaml
type: base
views:
  - type: table
    name: Cards
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

More prose after the block.
`

const CALLOUT_TEXT = `# Callout Test

Before the callout.

> [!KEY] KEY:
> frontier — line
> set — area under the line (triangle)

After the callout.
`

const px = (v: string) => Math.round(parseFloat(v))
const styleOf = (el: Element | null) => (el ? getComputedStyle(el) : null)
const lineWith = (root: ParentNode, re: RegExp) =>
    [...root.querySelectorAll('.cm-line')].find(l => re.test(l.textContent ?? ''))

/** ONE ROW RHYTHM. A note sets prose in CMU Serif and pulls code/tables/frontmatter back to the
 *  mono face — but every one of those rows must still sit on the same leading, or a code fence
 *  reads as a cramped patch pasted into the note. `.cm-codeblock` carried its own `line-height:
 *  1.5`, which put its rows at 20px inside a document whose every other row was 27px. Asserts the
 *  leading is shared and that mono is at the MONO size, not the serif's optically-compensated one. */
export const MixedTypography: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Mixed.md': MIXED_TEXT } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Mixed.md"
                    initialText={MIXED_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = styleOf(canvasElement.querySelector('.cm-scroller'))!
        const rhythm = px(scroller.lineHeight)
        const codeLine = lineWith(canvasElement, /type: base/)
        const fmLine = lineWith(canvasElement, /tags:/)
        if (!codeLine || !fmLine) throw new Error('code / frontmatter line not rendered')
        // The regression this story exists for: a code fence on its own tighter leading.
        await expect(px(styleOf(codeLine)!.lineHeight)).toBe(rhythm)
        await expect(px(styleOf(fmLine)!.lineHeight)).toBe(rhythm)
        // Mono constructs take --editor-font-size, never --prose-font-size (which is that size
        // times --prose-scale, a compensation that only means anything for the serif). The
        // baseline is the CSS custom property itself — the independent source of truth — not
        // codeLine, which is the element under test: deriving "mono" from the thing being
        // asserted on would let a shared regression pass every check while measuring a fiction.
        const root = getComputedStyle(document.documentElement)
        const editorPx = parseFloat(root.getPropertyValue('--editor-font-size'))
        await expect(Number.isFinite(editorPx) && editorPx > 0).toBe(true)
        await expect(parseFloat(styleOf(codeLine)!.fontSize)).toBe(editorPx)
        await expect(parseFloat(styleOf(fmLine)!.fontSize)).toBe(editorPx)
        await expect(parseFloat(scroller.fontSize)).toBeGreaterThan(editorPx)
        // Extra cross-check, not the primary assertion: code and frontmatter agree with each other.
        await expect(styleOf(codeLine)!.fontSize).toBe(styleOf(fmLine)!.fontSize)
        // Prose, headings included, is the proportional face; code is not.
        await expect(scroller.fontFamily).toMatch(/CMU Serif/)
        await expect(styleOf(canvasElement.querySelector('.cm-h1'))!.fontFamily).toMatch(/CMU Serif/)
        await expect(styleOf(codeLine)!.fontFamily).toMatch(/Monaspace/)
    },
}

/** A rendered callout, and the ONE way back into it. `CalloutWidget.ignoreEvent` returned a
 *  blanket `true`, which tells CodeMirror to ignore every event inside the widget — including the
 *  double-click that reveals it — so a callout became permanently uneditable the moment it
 *  rendered. Nothing about that is visible in a screenshot: the widget looks correct either way.
 *  This story clicks it. */
export const Callout: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Callout.md': CALLOUT_TEXT } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Callout.md"
                    initialText={CALLOUT_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const quoteLines = () =>
            [...canvasElement.querySelectorAll('.cm-line')].filter(l =>
                /^>/.test((l.textContent ?? '').trim()),
            ).length
        const widget = canvasElement.querySelector('.cm-callout-wrap')
        if (!widget) throw new Error('callout did not render as a widget')
        // Resting state: rendered, with its raw blockquote source replaced.
        await expect(quoteLines()).toBe(0)
        const r = widget.getBoundingClientRect()
        const at = {
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            bubbles: true,
        }
        // A single click must NOT reveal it — that is the "not a stray click" half of the rule.
        widget.dispatchEvent(new MouseEvent('mousedown', at))
        widget.dispatchEvent(new MouseEvent('mouseup', at))
        widget.dispatchEvent(new MouseEvent('click', at))
        await new Promise(res => setTimeout(res, 120))
        await expect(quoteLines()).toBe(0)
        // Double-click reveals the raw source. This is the assertion that fails on a blanket
        // `ignoreEvent(): true`.
        widget.dispatchEvent(new MouseEvent('dblclick', at))
        await new Promise(res => setTimeout(res, 250))
        await expect(quoteLines()).toBeGreaterThan(0)
    },
}

const CALLOUT_SELECTION_TEXT =
    'Before the callout.\n\n> [!note] Heads up\n> the body of the callout\n\nAfter the callout.\n'

/** Dragging a selection ACROSS a rendered callout must reveal its raw markdown. The callout was
 *  the one live-preview block that only opened on double-click, so a user selecting a region of
 *  the note saw every other construct show its source and this one stay rendered.
 *
 *  Editor.tsx does not expose its EditorView as a prop (and this file does not modify it — see
 *  the header comment), so the story recovers the real, live view via CodeMirror's own
 *  `EditorView.findFromDOM` instead of reaching into a DOM event simulation — the same "dispatch
 *  a real selection" approach BlockSelection.stories.tsx uses, just recovering the view handle a
 *  different way. */
export const CalloutSelection: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'CalloutSelection.md': CALLOUT_SELECTION_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="CalloutSelection.md"
                    initialText={CALLOUT_SELECTION_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const dom = canvasElement.querySelector('.cm-editor')
        const view = dom && EditorView.findFromDOM(dom as HTMLElement)
        if (!view) throw new Error('could not find EditorView')

        // Rendered first: the widget is present, the raw source is not.
        await expect(canvasElement.querySelector('.cm-callout-wrap')).not.toBeNull()
        await expect(canvasElement.textContent).not.toMatch(/\[!note\]/)

        // Select from the prose above the callout to the prose below it.
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })

        await expect(canvasElement.textContent).toMatch(/\[!note\] Heads up/)
        await expect(canvasElement.querySelector('.cm-callout-wrap')).toBeNull()
    },
}
