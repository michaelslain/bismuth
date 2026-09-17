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
import { expect, waitFor } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import { Editor } from './Editor'
import { setTransport } from './api'
import {
    startCompletion,
    acceptCompletion,
    completionStatus,
    selectedCompletionIndex,
    currentCompletions,
} from '@codemirror/autocomplete'
import { taskDescStart } from './editor/taskComplete'
import { settings, setSettings } from './settings'
import { fakeTransport } from './ui/_fakeTransport'
import { expectProseFace, expectEditorFace, expectEditorSize, expectBoundToEditorFont } from './ui/_fontFace'
import { CONTENT_PAD_BOTTOM, SCROLL_PAD_VAR } from './editor/drawScrollSpace'
import {
    insertDrawBlock,
    scanDrawBlocks,
} from '../../core/src/drawing/drawBlocks'
import type { Stroke } from '../../core/src/drawing/model'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'
import type { Row } from '../../core/src/bases/types'

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
// `path` is a note id — `.md` stripped, matching production (graph node ids never carry it).
const NOTE_NAMES: NoteCandidate[] = [
    { label: 'Another Note', path: 'Another Note' },
    { label: 'Project Plan', path: 'projects/Project Plan' },
    { label: 'Reading List', path: 'reading/Reading List' },
    // Two notes sharing a basename — so the `[[wikilink]]` popup is inspectable with a
    // duplicate-name case: both should show their full folder and insert a path-qualified link.
    { label: 'Plan', path: 'Projects/Alpha/Plan' },
    { label: 'Plan', path: 'Archive/Plan' },
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

/** ONE ROW RHYTHM. A note sets prose in CMU Serif and pulls code/frontmatter back to the mono
 *  face — but every one of those rows must still sit on the same leading, or a code fence reads
 *  as a cramped patch pasted into the note. `.cm-codeblock` carried its own `line-height: 1.5`,
 *  which put its rows at 20px inside a document whose every other row was 27px. Asserts the
 *  leading is shared and that mono is at the MONO size, not the serif's optically-compensated one.
 *
 *  Tables are PROSE too (they were pulled back to the mono face along with code and frontmatter;
 *  the user asked for that reversed) — MIXED_TEXT already renders one, so its cell is asserted
 *  here rather than in a second story. Asserted against `--prose-font` rather than a literal
 *  family name, because the token is the source of truth and a hardcoded stack would pass while
 *  rendering the wrong face. */
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
        // Tables are PROSE. Asserted against --prose-font rather than a literal family name — see
        // the story doc comment above.
        const tableCell = canvasElement.querySelector('.cm-table, .cm-table-rendered') as HTMLElement
        await expect(tableCell).not.toBeNull()
        expectProseFace(tableCell)
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

// A minimal Row satisfying core/src/bases/types.ts's Row interface — enough for
// deriveColumns() (core/src/bases/query.ts) to produce a `file.name` + `note.title` table.
const QUERY_ROW: Row = {
    file: {
        name: 'Query Row',
        basename: 'Query Row',
        path: 'Query Row.md',
        folder: '',
        ext: 'md',
        size: 0,
        ctime: 0,
        mtime: 0,
        tags: [],
        links: [],
    },
    note: { title: 'Query Row' },
    formula: {},
}

const QUERY_BLOCK_TEXT = `# Query Block Sizing

| a | b |
| --- | --- |
| 1 | 2 |

\`\`\`query
tasks:
view: table
\`\`\`
`

/** Regression for content.css's \`.bismuth-query-block table/td/th\` rule: an embedded
 *  \`\`\`query block (editor/queryBlock.ts's QueryBlockWidget, class \`.bismuth-query-block\`)
 *  renders a base view INSIDE a note, so its table must follow the note's OWN prose size
 *  (--prose-font-size), not the mono chrome size (--editor-font-size) a standalone base view
 *  uses. The rule used to pin --editor-font-size, which — now that note markdown tables render
 *  at --prose-font-size (this file's MixedTypography story; Editor.tsx's editorTheme) — left a
 *  query-block table ~22% smaller than the note's own table directly above it: serif at mono
 *  size, the exact combination Editor.css's "TABLES ARE PROSE" comment documents as wrong.
 *  Asserts the two cells resolve to the SAME computed font-size instead of hardcoding either
 *  token, so a regression on either side of the pair fails this story. */
export const QueryBlockSizing: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { 'Query Block Sizing.md': QUERY_BLOCK_TEXT },
                rows: [QUERY_ROW],
            }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Query Block Sizing.md"
                    initialText={QUERY_BLOCK_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // The query block resolves its rows async (BaseView's createResource + a mounted Solid
        // tree), so wait for its table to actually paint rather than reading a still-loading DOM.
        const queryCell = await waitFor(() => {
            const el = canvasElement.querySelector('.bismuth-query-block td')
            if (!el) throw new Error('query block table not rendered yet')
            return el as HTMLElement
        })
        const noteTableCell = canvasElement.querySelector(
            '.cm-table, .cm-table-rendered',
        ) as HTMLElement
        await expect(noteTableCell).not.toBeNull()
        const queryFontSize = getComputedStyle(queryCell).fontSize
        const noteFontSize = getComputedStyle(noteTableCell).fontSize
        await expect(queryFontSize).toBe(noteFontSize)
        // And the pair is genuinely at the note's prose size, not a coincidental match at the
        // mono size — pins the assertion to the actual regression this story guards against.
        // --prose-font-size is itself a `calc(--editor-font-size * --prose-scale)` (tokens.css),
        // so reading it back via getPropertyValue returns the unresolved calc() text, not a
        // number — read the two plain-number tokens it's built from and multiply instead.
        const root = getComputedStyle(document.documentElement)
        const editorPx = parseFloat(root.getPropertyValue('--editor-font-size'))
        const proseScale = parseFloat(root.getPropertyValue('--prose-scale'))
        await expect(Number.isFinite(editorPx) && editorPx > 0).toBe(true)
        await expect(Number.isFinite(proseScale) && proseScale > 0).toBe(true)
        await expect(parseFloat(queryFontSize)).toBe(
            Math.round(editorPx * proseScale * 100) / 100,
        )
    },
}

// A table that must actually WRAP: 6 columns, 8 rows, long free-text cells, a very long unbroken
// token, and mixed content (a wikilink, inline code, a number column). The repo's only other table
// fixture is a 2x2 of single characters, which cannot exercise any of this — and note tables just
// moved from the mono size to --prose-font-size (~28% larger), so wrapping and overflow under a
// wide table is precisely what that change put at risk and nothing rendered.
const DENSE_TABLE_TEXT = [
    '# Dense Table',
    '',
    'Prose above the table, for a same-note size comparison.',
    '',
    '| Component | Owner | Status | Notes | Est. | Ref |',
    '| --- | --- | --- | --- | --- | --- |',
    '| Knowledge graph renderer | platform | in review | Character-grid canvas; zoom is resolution, not scale, so a wheel notch re-rasterizes | 13 | [[Another Note]] |',
    '| Bases query pipeline | data | shipped | `lexer -> parser -> evaluate -> query`, cycle-guarded across recursive base sources | 8 | [[Project Plan]] |',
    '| Flashcard scheduler | learning | blocked | SM-2 with a bidirectional variant writing `*Back` columns | 5 | [[Reading List]] |',
    '| Terminal PTY bridge | platform | shipped | Reattaches on abnormal close within a grace window keyed by term id | 21 | — |',
    '| Calendar two-way sync | integrations | in progress | supercalifragilisticexpialidociousandthensome | 34 | — |',
    '| Drawing export | docs | todo | Vector to PNG and PDF, headless, no browser | 3 | — |',
    '| Daemon cron fan-out | daemon | shipped | One machine process multiplexing every enabled vault per tick | 13 | — |',
    '| Settings schema | platform | shipped | Single source of truth; parity enforced by a test | 2 | — |',
    '',
    'Prose below the table.',
    '',
].join('\n')

/** Wide, dense, wrapping table — the coverage gap the mono→prose size change opened. The only
 *  other table fixture in the repo is a 2x2 of single characters, so no story has ever rendered a
 *  table whose cells must wrap, whose row is taller than one line, or that could overflow its
 *  container. Asserts three things a 2x2 cannot: the table renders in the prose face, at least one
 *  cell genuinely WRAPS to more than one line, and the table does not overflow the editor
 *  horizontally (a note must never scroll sideways). */
export const DenseTable: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Dense Table.md': DENSE_TABLE_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Dense Table.md"
                    initialText={DENSE_TABLE_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // The editable-table widget renders async (CodeMirror decoration pass) — poll rather than
        // read immediately. playCheck deliberately does NOT force prefers-reduced-motion, so a
        // value read on the first frame can be mid-transition.
        //
        // A real .cm-td cell only — not '.cm-table, .cm-table-rendered, .cm-td'. querySelector
        // with an OR'd list returns the first DOCUMENT-ORDER match, not the first listed selector,
        // and .cm-table-rendered is the <table> itself, which always precedes its own <td>
        // children — so that broader query always resolved to the table, never a cell. The
        // table's own line-height comes from the editor's unrelated base row rhythm
        // (settings.editor.lineHeight), while a .cm-td's comes from
        // `--cm-td-lh` (livePreview.ts) — measuring the table masks the very cell line-box this
        // story needs. The widget's toDOM() builds every cell synchronously, so .cm-td existing is
        // already sufficient proof the table rendered.
        const cell = await waitFor(() => {
            const el = canvasElement.querySelector('.cm-td')
            if (!el) throw new Error('table not rendered yet')
            return el as HTMLElement
        })

        // 1. Tables are prose.
        expectProseFace(cell)

        // 2. Something actually wrapped. A cell whose rendered height exceeds ~1.8 line-boxes is
        //    on more than one line — the condition a 2x2 fixture can never reach, and the one the
        //    ~28% size increase threatened.
        const cells = [
            ...canvasElement.querySelectorAll('.cm-td, td'),
        ] as HTMLElement[]
        await expect(cells.length).toBeGreaterThan(20)
        const lineH = parseFloat(getComputedStyle(cell).lineHeight)
        await expect(Number.isFinite(lineH) && lineH > 0).toBe(true)
        const wrapped = cells.filter(
            c => c.getBoundingClientRect().height > lineH * 1.8,
        )
        await expect(wrapped.length).toBeGreaterThan(0)

        // 3. And it did not buy that wrapping by overflowing the note sideways.
        const scroller = canvasElement.querySelector(
            '.cm-scroller',
        ) as HTMLElement
        await expect(scroller).not.toBeNull()
        await expect(scroller.scrollWidth).toBeLessThanOrEqual(
            scroller.clientWidth + 1,
        )
    },
}

const REVEAL_TEXT = `# Reveal Marks

A paragraph with **bold text**, a #demo-tag, and \`inline code\`.

- bullet one

1. ordered one
`

/** Regression for Editor.css's size-reset list: .cm-list-marker / .cm-syntax-mark / .cm-tag set
 *  their font-family INLINE in livePreview.ts's EditorView.theme() rather than through the
 *  family-reset selector list, and were never added to the paired SIZE-reset list either — so
 *  all three silently inherited --prose-font-size (17.28px against the intended 13.5px, exactly
 *  the 1.28 --prose-scale optical compensation meant only for CMU Serif prose). The user's exact
 *  report was the revealed "1. " on a numbered list.
 *
 *  Compares against the LIVE --editor-font-size token, never a hardcoded 13.5 — the size is a
 *  user setting (appearance.editorFontSize). .cm-tag is always visible with no caret needed;
 *  .cm-syntax-mark/.cm-list-marker only render while the caret sits ON the specific token/line
 *  that owns them (livePreview's per-token reveal — moving off unreveals it again), so the
 *  play() checks each one immediately after placing the caret there, rather than moving through
 *  every needle first and checking at the end. EditorView.findFromDOM + dispatch is the same
 *  reliable approach CalloutSelection uses instead of synthesising clicks. */
export const RevealedMarks: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Reveal Marks.md': REVEAL_TEXT } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Reveal Marks.md"
                    initialText={REVEAL_TEXT}
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
        // livePreview.ts gates its per-token reveal on view.hasFocus (an unfocused editor renders
        // fully, so a card grid's off-focus editors don't leak raw markdown) — without this the
        // caret moves below have no visible effect at all.
        view.focus()

        // Compare against the token, never a hardcoded 13.5 — the size is a setting.
        const editorPx = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size'),
        )
        await expect(Number.isFinite(editorPx) && editorPx > 0).toBe(true)

        const assertMonoSize = (sel: string) => {
            const els = canvasElement.querySelectorAll(sel)
            if (!els.length) throw new Error(`${sel} did not render`)
            for (const el of els) {
                expect(parseFloat(getComputedStyle(el).fontSize)).toBe(editorPx)
            }
        }

        assertMonoSize('.cm-tag')

        // Each reveal is per-token/per-line, not sticky — check it while the caret is still
        // there, before moving on to the next needle un-reveals it again.
        const revealAt = async (needle: string) => {
            const at = REVEAL_TEXT.indexOf(needle)
            view.dispatch({ selection: { anchor: at, head: at } })
            await new Promise(r => setTimeout(r, 50))
        }

        await revealAt('bold text')
        assertMonoSize('.cm-syntax-mark')

        await revealAt('- bullet one')
        assertMonoSize('.cm-list-marker')

        await revealAt('1. ordered one')
        assertMonoSize('.cm-list-marker')
    },
}

const LINK_COVERAGE_TEXT = [
    '# Link Coverage',
    '',
    'Check the [docs](https://example.com/docs) before shipping.',
    'See the write-up at [full spec](https://example.com/spec)',
    '',
    'Visit https://example.com/bare-mid for the changelog before you start.',
    'Read more at https://example.com/bare-end',
    '',
    'Open [[Another Note]] for context before continuing.',
    'Also see [[Project Plan]]',
    '',
].join('\n')

/** Regression for zero story coverage of `pushMarkdownLinks`/`pushBareUrls`
 *  (livePreview.ts:428,455) — `Editor.stories.tsx` had no `[text](url)` and no bare URL
 *  anywhere; only the wikilink path was ever exercised, via DEFAULT_TEXT's
 *  `[[Another Note]]`. This fixture carries all three link forms — a markdown link, a bare
 *  `https://…` URL, and a `[[Wikilink]]` — each once mid-sentence and once at end-of-line,
 *  and the play() asserts a decoration actually rendered for every one of the six, so the
 *  story cannot silently degrade to asserting nothing.
 *
 *  Also pins the invariant commit 80b1e30b established and this plan's investigation
 *  reconfirmed: off-cursor hidden syntax (the markdown link's `[`/`](url)`, the wikilink's
 *  `[[`/`]]`) always measures zero width, never merely small — ruling it out as the cause
 *  of the reported "space after a hyperlink" (that report remains open, pending an example;
 *  see the plan's "Open with the user" section). The editor starts unfocused, so
 *  `view.hasFocus` is false and every link renders in its off-cursor, syntax-hidden state
 *  with no caret placement needed (compare RevealedMarks, which must call `view.focus()`
 *  because it asserts the REVEALED state instead). */
export const LinkCoverage: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Link Coverage.md': LINK_COVERAGE_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Link Coverage.md"
                    initialText={LINK_COVERAGE_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // The decoration pass runs synchronously on mount for the other link-adjacent
        // stories in this file (RevealedMarks reads `.cm-tag` with no wait at all), but wait
        // here anyway so this story does not depend on that timing staying true.
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-link')) {
                throw new Error('links not rendered yet')
            }
            return true
        })

        const hasText = (sel: string, text: string) =>
            [...canvasElement.querySelectorAll(sel)].some(
                el => el.textContent === text,
            )

        // Markdown links `[text](url)` — mid-sentence and at end-of-line — render as their
        // link TEXT (the URL itself stays hidden off-cursor).
        await expect(hasText('.cm-link', 'docs')).toBe(true)
        await expect(hasText('.cm-link', 'full spec')).toBe(true)
        // Bare URLs — mid-sentence and at end-of-line — render as the full URL, nothing hidden.
        await expect(hasText('.cm-link', 'https://example.com/bare-mid')).toBe(true)
        await expect(hasText('.cm-link', 'https://example.com/bare-end')).toBe(true)
        // Wikilinks — mid-sentence and at end-of-line — render as the bare basename.
        await expect(hasText('.cm-wikilink', 'Another Note')).toBe(true)
        await expect(hasText('.cm-wikilink', 'Project Plan')).toBe(true)

        // 80b1e30b's invariant: every off-cursor hidden-syntax run is genuinely zero-width,
        // not just small. The length check is load-bearing — without it the loop below is
        // vacuous and passes having measured nothing.
        const hidden = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-hidden-syntax',
        )
        await expect(hidden.length).toBeGreaterThan(0)
        for (const el of hidden) {
            await expect(el.getBoundingClientRect().width).toBeLessThan(0.5)
        }
    },
}

const TAG_TYPOGRAPHY_TEXT = [
    'A body tag: #project and another #planning here.',
    '',
    '| topic | tags |',
    '| --- | --- |',
    '| first | #project |',
    '| second | #draft |',
    '',
    'Trailing prose so the caret has somewhere to sit off the table.',
].join('\n')

/** #tags read in the EDITOR's mono face at the editor size on every surface (the user's call,
 *  2026-09-03: "they should all be the same, monaspace"). This story covers the two CodeMirror
 *  paths — the `.cm-tag` decoration in body prose, and the `span.bismuth-tag` that
 *  bases/markdown.ts writes into a RENDERED table cell, which reaches a different stylesheet
 *  (Editor.css) than the decoration does (livePreview.ts's theme). ChatView carries the other
 *  surface.
 *
 *  expectBoundToEditorFont, alongside expectEditorFace, is load-bearing here: --editor-font and
 *  --ui-font-stack both default to Monaspace Xenon, so a rule reverted to var(--ui-font-stack) —
 *  the exact site of the original drift — would still satisfy expectEditorFace's resolved-value
 *  comparison. Only repointing the token and confirming the element follows proves the rule is
 *  bound to the right one. */
export const TagTypography: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Tag Typography.md': TAG_TYPOGRAPHY_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Tag Typography.md"
                    initialText={TAG_TYPOGRAPHY_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-tag')) {
                throw new Error('body tags not decorated yet')
            }
            return true
        })
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-td .bismuth-tag')) {
                throw new Error('table not rendered yet')
            }
            return true
        })

        // The length guards are load-bearing: without them each loop below passes having
        // measured nothing at all.
        const body = canvasElement.querySelectorAll<HTMLElement>('.cm-tag')
        await expect(body.length).toBeGreaterThan(0)
        for (const el of body) {
            expectEditorFace(el)
            expectEditorSize(el)
            expectBoundToEditorFont(el)
        }

        const inTable = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-td .bismuth-tag',
        )
        await expect(inTable.length).toBeGreaterThan(0)
        for (const el of inTable) {
            expectEditorFace(el)
            expectEditorSize(el)
            expectBoundToEditorFont(el)
        }

        // The two paths must agree with EACH OTHER too, not merely each with the token —
        // a token that failed to resolve would satisfy both checks above independently.
        await expect(getComputedStyle(inTable[0]!).fontSize).toBe(
            getComputedStyle(body[0]!).fontSize,
        )
    },
}

const TASK_FIELDS_TEXT = [
    '# Task Fields',
    '',
    '- [ ] buy milk [due 2026-09-14] [high] [every week]',
    '- [ ] call the dentist [due 2026-09-14]',
    '- [x] renew passport [done 2026-09-02]',
    '- [ ] read [chapter 3] plus [chapter 2026-09-14] plus [due 2026-02-30]',
    '',
].join('\n')

// Bracket groups that FIELD_SCAN matches as CANDIDATES but parseFields does not accept as
// fields — an unknown key, an unknown key with a date-shaped value, and a real key with a
// calendar-impossible date. Line 4 above carries all three in one description. None may ever
// render as a `.cm-task-field` chip: a chip on `[due 2026-02-30]` would tell the user it IS a
// recognised date, which is exactly the drift `isFieldText` (core/src/taskFields.ts) exists to
// prevent — the parser's disambiguation rule that keeps a mistyped/impossible date visible as
// plain text would otherwise be silently defeated by the editor's own rendering.
const NON_FIELD_BRACKETS = ['[chapter 3]', '[chapter 2026-09-14]', '[due 2026-02-30]']

/** Regression for livePreview.ts's bracket task-field chip (tasks-replacement plan, Task 6):
 *  `[due 2026-09-14]`, `[high]`, `[every week]` each render wrapped in `.cm-task-field`. It is
 *  a MARK, not a replace widget — the raw bracket text IS the chip, so unlike RevealedMarks'
 *  syntax marks there is no hide/reveal state: the chip must render identically off-cursor and
 *  with the caret sitting on that exact line. The play() checks both, and also pins
 *  NON_FIELD_BRACKETS as never chipped — the fix round that added `isFieldText` gating.
 *
 *  5 real fields across 3 lines: due + high + every week on line 1, due on line 2, done on
 *  line 3 (a completed task's `[done …]` sits inside the taskDoneMark strike range too — both
 *  marks are `Decoration.mark`, which nest rather than collide). Line 4 adds 3 MORE bracket
 *  groups that must NOT be chipped, for 8 FIELD_SCAN candidates total but still 5 chips. */
export const TaskFields: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Task Fields.md': TASK_FIELDS_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Task Fields.md"
                    initialText={TASK_FIELDS_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-task-field')) {
                throw new Error('task fields not decorated yet')
            }
            return true
        })

        const fields = canvasElement.querySelectorAll<HTMLElement>('.cm-task-field')
        await expect(fields.length).toBe(5)
        for (const el of fields) {
            expectEditorFace(el)
            expectEditorSize(el)
            // The literal syntax IS the chip's content — a mark decorates, it never replaces.
            await expect(el.textContent).toMatch(/^\[.*\]$/)
            // Legible: not collapsed to zero width the way a hidden syntax mark renders
            // off-cursor (see LinkCoverage's note on that invariant).
            await expect(el.getBoundingClientRect().width).toBeGreaterThan(0)
        }

        // None of NON_FIELD_BRACKETS ever got wrapped in a chip — proves FIELD_SCAN's
        // candidates are gated through isFieldText, not decorated on sight.
        const chipTexts = Array.from(fields).map(el => el.textContent)
        for (const raw of NON_FIELD_BRACKETS) {
            await expect(chipTexts).not.toContain(raw)
        }
        // And they are still PRESENT as ordinary text (parseFields leaves them in the
        // description) — this is "no chip", never "the text vanished".
        const editorText = canvasElement.querySelector('.cm-editor')?.textContent ?? ''
        for (const raw of NON_FIELD_BRACKETS) {
            await expect(editorText).toContain(raw)
        }

        // Put the caret ON the first task line, inside its `[due …]` field, and confirm every
        // chip on that line is still a legible mark rather than getting swallowed by the
        // checkbox-widget replace or the raw-prefix reveal that also fire on the cursor line.
        const dom = canvasElement.querySelector('.cm-editor')
        const view = dom && EditorView.findFromDOM(dom as HTMLElement)
        if (!view) throw new Error('could not find EditorView')
        view.focus()
        const at = TASK_FIELDS_TEXT.indexOf('[due 2026-09-14]')
        view.dispatch({ selection: { anchor: at, head: at } })
        await new Promise(r => setTimeout(r, 50))

        const onCursorLine = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-task-field',
        )
        await expect(onCursorLine.length).toBe(5)
        for (const el of onCursorLine) {
            await expect(el.getBoundingClientRect().width).toBeGreaterThan(0)
        }
    },
}

const DRAW_TOGGLE_TEXT = [
    '---',
    'title: Draw Toggle',
    '---',
    '',
    'alpha one alpha one',
    'alpha two alpha two',
    '',
    'beta one beta one',
    '',
].join('\n')

/** THE draw-mode data-loss regression. Entering draw mode must not disturb the buffer — not its
 *  text, and not the view holding it.
 *
 *  What this pins, and why each half is asserted separately:
 *
 *  - **The buffer keeps its unsaved edits.** `setDraw`'s guard used to read `drawMode()`
 *    REACTIVELY, and `setDraw` is called from inside the view-building effect
 *    (`if (pathChanged) setDraw(false)`) — so that effect subscribed to `drawMode` and the first
 *    toggle after a note opened re-ran it, seeding a fresh view from `props.initialText`: the
 *    note as it stood when FileView fetched it, which a `createResource` keyed on the path never
 *    refreshes. Reproduced in the running app by dragging a standalone drawing to a new slot
 *    (drawBlock.ts's reorder, on disk within a second) and then entering draw mode: the drawing
 *    jumped back to its original position and the first ink commit wrote the reverted note over
 *    the file. Typed text was lost identically — the bug is not about drawings, it is about
 *    everything since the note opened.
 *  - **The view instance survives.** `editor/rebuildSeed.ts` makes the seed impossible to be
 *    stale, so a rebuild would no longer LOSE anything — but it would still throw away the undo
 *    history, the selection and the scroll position, and Editor.tsx's own comment on
 *    `editableCompartment` promises the opposite ("toggling never rebuilds the view"). Identity
 *    is what holds that promise; text alone would pass with the rebuild still happening.
 *
 *  The settle before the assertions is load-bearing: the rebuild was measured 7ms AFTER the
 *  toggle, so an assertion that ran on the same tick passed against the broken code. */
export const DrawModeKeepsBuffer: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Draw Toggle.md': DRAW_TOGGLE_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Draw Toggle.md"
                    initialText={DRAW_TOGGLE_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const liveView = () => {
            const dom = canvasElement.querySelector('.cm-editor')
            const v = dom && EditorView.findFromDOM(dom as HTMLElement)
            if (!v) throw new Error('could not find EditorView')
            return v
        }
        const before = liveView()
        await expect(before.state.facet(EditorView.editable)).toBe(true)

        // An edit that exists ONLY in the buffer — `props.initialText` has never heard of it,
        // which is exactly the state a drag-then-draw leaves the note in.
        const MARK = 'ONLY-IN-THE-BUFFER'
        before.dispatch({
            changes: { from: before.state.doc.length, insert: `${MARK}\n` },
        })
        await expect(before.state.doc.toString()).toContain(MARK)

        // The real keybinding path: Editor.tsx listens on its own wrapper in the capture phase,
        // so a bubbling keydown from the content reaches it exactly as the user's would.
        canvasElement.querySelector('.cm-content')!.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'I',
                code: 'KeyI',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
            }),
        )
        // Let a rebuild happen if it is going to. Without this the play asserts against the
        // frame BEFORE the effect re-runs and passes on the broken code.
        await new Promise(r => setTimeout(r, 150))

        // The toggle really landed — otherwise everything below passes vacuously.
        await waitFor(() =>
            expect(liveView().state.facet(EditorView.editable)).toBe(false),
        )

        const after = liveView()
        await expect(after.state.doc.toString()).toContain(MARK)
        await expect(after).toBe(before)
    },
}

/** The GENERAL contract the draw-mode bug was one instance of: a rebuild of the SAME buffer
 *  never loses what is in it.
 *
 *  Editor.tsx builds its view inside a `createEffect` that reads every `settings.editor` leaf,
 *  so a wrapping toggle, a gutter toggle or a font change tears the view down and builds a new
 *  one — mid-session, with the buffer holding whatever the user has typed since the note opened.
 *  This story flips one of those leaves directly and asserts the buffer comes back intact. It is
 *  the reachable-without-drawing half: DrawModeKeepsBuffer pins that the draw toggle does not
 *  rebuild at ALL, and this pins that the rebuilds which legitimately DO happen are harmless.
 *
 *  Three separate defects lived on this path, and each one alone loses the edit:
 *   - the new view was seeded from `props.initialText`, a snapshot FileView took when the note
 *     opened and never refreshes (editor/rebuildSeed.ts);
 *   - the rebuild reset `diskBase`, then re-stamped it to the buffer's OWN text, so an
 *     in-flight `save()` — which re-reads that anchor after its own `await api.read` — merged
 *     base === mine, read it as "no local change", and wrote disk back over the buffer;
 *   - it reset `pendingSave`, which is the SSE reconcile's only guard against the same revert.
 *
 *  The rebuild is asserted to have actually HAPPENED (a new EditorView instance). Without that
 *  the story would pass on a build where the settings leaf simply stopped being a dependency,
 *  which is not the property being pinned. */
export const SettingsRebuildKeepsBuffer: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Rebuild Buffer.md': DRAW_TOGGLE_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Rebuild Buffer.md"
                    initialText={DRAW_TOGGLE_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const liveView = () => {
            const dom = canvasElement.querySelector('.cm-editor')
            const v = dom && EditorView.findFromDOM(dom as HTMLElement)
            if (!v) throw new Error('could not find EditorView')
            return v
        }
        const before = liveView()
        const MARK = 'UNSAVED-ACROSS-A-REBUILD'
        before.dispatch({
            changes: { from: before.state.doc.length, insert: `${MARK}\n` },
        })
        await expect(before.state.doc.toString()).toContain(MARK)

        // A leaf the view-building effect reads — flipping it is a same-path rebuild, the exact
        // thing a user does by toggling line numbers while a note is open.
        const restore = settings.editor.lineNumbers
        setSettings('editor', 'lineNumbers', !restore)
        try {
            // The rebuild is queued, and the in-flight save this races resolves a tick later.
            await waitFor(() => expect(liveView()).not.toBe(before))
            await new Promise(r => setTimeout(r, 250))

            const after = liveView()
            await expect(after).not.toBe(before) // the rebuild really happened
            await expect(after.state.doc.toString()).toContain(MARK)
        } finally {
            // The settings store is module-level and shared by every story in the run.
            setSettings('editor', 'lineNumbers', restore)
        }
    },
}

// ── Rebindable open-completion transitions ──────────────────────────────────────────────────
// editor/settingsKeymap.ts's settingsKeymapCompartment reconfigures a CM Compartment IN PLACE
// on a rebind, instead of rebuilding the view the way SettingsRebuildKeepsBuffer's
// `settings.editor.*` leaves do. `createEffect` is a no-op under `bun test` (bare `solid-js`
// resolves to its SSR build there, where it is literally `function createEffect() {}`), so these
// three stories — run under REAL client Solid — are the only place any of this is provable:
//   1. a rebind takes effect without rebuilding (same EditorView instance, buffer, scroll)
//   2. the OLD combo is fully replaced, not merely joined by the new one
//   3. a settings change that is NOT a keybinding still goes through the ordinary rebuild path
// Every keypress below is a real synthetic KeyboardEvent dispatched at `.cm-content` (never a
// direct command call), with a faithful `key` AND `code` pair — `key: ' ', code: 'Space'` for
// Ctrl+Space, matching the project's synthetic-KeyboardEvent trap.

// Long enough to scroll on its own (proves scroll position survives a rebind), ending in a bare
// task line so `[due` has a real completion source to open against — the same context
// TaskFieldAutocomplete uses, just reached via a real keybinding instead of a direct command
// call.
const REBIND_SCROLL_TEXT = [
    '# Rebind Completion',
    '',
    ...Array.from(
        { length: 60 },
        (_, i) => `Paragraph ${i + 1}, long enough that the note scrolls on its own.`,
    ),
    '',
    '- [ ] rent [due',
    '',
].join('\n')

const renderRebindStory = (path: string) => {
    setTransport(fakeTransport({ files: { [path]: REBIND_SCROLL_TEXT } }))
    return (
        <div style={{ height: STORY_H, width: '100%' }}>
            <Editor
                path={path}
                initialText={REBIND_SCROLL_TEXT}
                onSaved={noop}
                noteNames={() => NOTE_NAMES}
                memoryNames={() => MEMORY_NAMES}
                tagNames={() => TAG_NAMES}
            />
        </div>
    )
}

/** Ctrl+Space is the shipped default; Alt+O is a combo nothing else in this keymap uses, so
 *  rebinding to it is unambiguous evidence the NEW combo (not some other coincidental binding)
 *  is what opened the popup. */
const dispatchOpenCompletionCombo = (target: Element, combo: 'old' | 'new') => {
    const init: KeyboardEventInit =
        combo === 'old'
            ? { key: ' ', code: 'Space', ctrlKey: true }
            : { key: 'o', code: 'KeyO', altKey: true }
    target.dispatchEvent(
        new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }),
    )
}

const waitForCompletionActive = async (view: EditorView) => {
    for (
        let i = 0;
        i < 100 && completionStatus(view.state) !== 'active';
        i++
    ) {
        await new Promise(r => setTimeout(r, 10))
    }
    await expect(completionStatus(view.state)).toBe('active')
}

/** Poll until a just-triggered completion is no longer `'pending'` (bounded — 100 * 10ms), then
 *  return whatever it settled to: `null` (no source returned options), or `'active'`. Sampling
 *  `completionStatus` once right after a keypress races CM's own async source resolution — see
 *  this file's header comment on the two rebind traps. Used for a NEGATIVE assertion (the combo
 *  must not open anything), where `waitForCompletionActive` above (which polls FOR `'active'`)
 *  is the wrong shape: there is no active state to wait for. */
const waitForCompletionSettled = async (view: EditorView) => {
    for (
        let i = 0;
        i < 100 && completionStatus(view.state) === 'pending';
        i++
    ) {
        await new Promise(r => setTimeout(r, 10))
    }
    return completionStatus(view.state)
}

/** The contract `settingsKeymapCompartment` exists for: a rebind mid-session takes effect
 *  through the SAME EditorView instance — no rebuild, so the buffer and scroll position survive
 *  it exactly the way DrawModeKeepsBuffer pins for the draw-mode toggle. */
export const RebindingOpenCompletionMidSessionTakesEffectWithoutRebuildingTheView: Story =
    {
        render: () => renderRebindStory('Rebind Mid-Session.md'),
        play: async ({ canvasElement }) => {
            const liveView = () => {
                const dom = canvasElement.querySelector('.cm-editor')
                const v = dom && EditorView.findFromDOM(dom as HTMLElement)
                if (!v) throw new Error('could not find EditorView')
                return v
            }
            const before = liveView()
            const at = REBIND_SCROLL_TEXT.indexOf('[due') + '[due'.length
            before.dispatch({ selection: { anchor: at, head: at } })
            before.focus()

            // A scroll position only a real rebuild would reset — REBIND_SCROLL_TEXT is 60+ paragraphs
            // tall against a 700px story container, so this is well within scrollable range.
            before.scrollDOM.scrollTop = 250
            const docBefore = before.state.doc.toString()

            const restore =
                settings.keybindings['open-completion']
            setSettings('keybindings', 'open-completion', 'Alt+O')
            try {
                // Give the compartment's createEffect a tick to reconfigure — the reconfigure
                // itself is a real `view.dispatch`, so polling on its observable effect (the new
                // combo opening completion) below is the actual deterministic seam; this is just
                // room for Solid's effect scheduler to run at all.
                await new Promise(r => setTimeout(r, 300))

                // Re-focus before dispatching: the scroll assignment + the compartment reconfigure
                // (both real `view.dispatch` calls) can leave the browser's own focus on nothing in
                // particular by this point (measured: `document.activeElement` had drifted to
                // `<body>`), and a synthetic keydown on an unfocused editor is not the same thing a
                // real rebind-then-type user does.
                before.focus()
                dispatchOpenCompletionCombo(
                    canvasElement.querySelector('.cm-content')!,
                    'new',
                )
                await waitForCompletionActive(before)

                const after = liveView()
                await expect(after).toBe(before) // no rebuild happened
                await expect(after.state.doc.toString()).toBe(docBefore) // buffer untouched
                await expect(after.scrollDOM.scrollTop).toBe(250) // scroll untouched
            } finally {
                // The settings store is module-level and shared by every story in the run.
                setSettings('keybindings', 'open-completion', restore)
            }
        },
    }

/** The half that catches a helper which merely ADDS the new binding instead of REPLACING the
 *  old one: after rebinding open-completion away from Ctrl+Space, the shipped default must no
 *  longer open anything. A helper with that bug would leave Ctrl+Space live alongside Alt+O and
 *  this assertion goes red, even though
 *  RebindingOpenCompletionMidSessionTakesEffectWithoutRebuildingTheView above would still pass. */
export const TheOldComboStopsFiringAfterARebind: Story = {
    render: () => renderRebindStory('Rebind Old Combo.md'),
    play: async ({ canvasElement }) => {
        const dom = canvasElement.querySelector('.cm-editor')
        const view = dom && EditorView.findFromDOM(dom as HTMLElement)
        if (!view) throw new Error('could not find EditorView')
        const at = REBIND_SCROLL_TEXT.indexOf('[due') + '[due'.length
        view.dispatch({ selection: { anchor: at, head: at } })
        view.focus()

        const restore = settings.keybindings['open-completion']
        setSettings('keybindings', 'open-completion', 'Alt+O')
        try {
            await new Promise(r => setTimeout(r, 300))

            const content = canvasElement.querySelector('.cm-content')!
            // Re-focus before dispatching: the rebind's compartment reconfigure is a real
            // `view.dispatch`, and by this point in the run the browser's own focus can have
            // drifted off the editor entirely (measured: `document.activeElement` was `<body>`)
            // — a synthetic keydown on an unfocused editor is not the same thing a real
            // rebind-then-type user does.
            view.focus()
            dispatchOpenCompletionCombo(content, 'old')
            // A fixed wait, then poll until any triggered query has settled (not a single sample
            // right after the keypress — that races CM's `'pending'` intermediate, see this
            // file's header comment). The assertion is that it settles to something other than
            // 'active', which a dead combo trivially satisfies by never leaving null.
            await new Promise(r => setTimeout(r, 300))
            await expect(await waitForCompletionSettled(view)).not.toBe('active')

            // Sanity: the new combo still works in this same session, so a null result above is
            // "the old combo is dead", not "nothing in this environment ever activates".
            view.focus()
            dispatchOpenCompletionCombo(content, 'new')
            await waitForCompletionActive(view)
        } finally {
            setSettings('keybindings', 'open-completion', restore)
        }
    },
}

/** The companion regression guard: the keybinding-compartment work must not have narrowed the
 *  view-building effect's dependencies so that only `settings.keybindings.*` triggers a rebuild.
 *  Same mechanism and shape as SettingsRebuildKeepsBuffer above (flip an unrelated
 *  `settings.editor` leaf, confirm a NEW EditorView instance carries the buffer forward) — kept
 *  as its own story here, named for this task's rebind-vs-rebuild contract specifically. */
export const ASettingsChangeThatIsNotAKeybindingStillRebuildsTheViewAsBefore: Story =
    {
        render: () => {
            setTransport(
                fakeTransport({ files: { 'Rebuild Still Works.md': DRAW_TOGGLE_TEXT } }),
            )
            return (
                <div style={{ height: STORY_H, width: '100%' }}>
                    <Editor
                        path="Rebuild Still Works.md"
                        initialText={DRAW_TOGGLE_TEXT}
                        onSaved={noop}
                        noteNames={() => NOTE_NAMES}
                        memoryNames={() => MEMORY_NAMES}
                        tagNames={() => TAG_NAMES}
                    />
                </div>
            )
        },
        play: async ({ canvasElement }) => {
            const liveView = () => {
                const dom = canvasElement.querySelector('.cm-editor')
                const v = dom && EditorView.findFromDOM(dom as HTMLElement)
                if (!v) throw new Error('could not find EditorView')
                return v
            }
            const before = liveView()
            const MARK = 'UNSAVED-ACROSS-A-NON-KEYBINDING-REBUILD'
            before.dispatch({
                changes: { from: before.state.doc.length, insert: `${MARK}\n` },
            })
            await expect(before.state.doc.toString()).toContain(MARK)

            const restore = settings.editor.lineNumbers
            setSettings('editor', 'lineNumbers', !restore)
            try {
                await waitFor(() => expect(liveView()).not.toBe(before))
                await new Promise(r => setTimeout(r, 250))

                const after = liveView()
                await expect(after).not.toBe(before) // the rebuild really happened
                await expect(after.state.doc.toString()).toContain(MARK)
            } finally {
                setSettings('editor', 'lineNumbers', restore)
            }
        },
    }

// ── Endless scroll space while drawing ──────────────────────────────────────────────────────
// The two stories below are the ONLY place the scroll-space rule can be checked: happy-dom has
// no layout engine, so `scrollHeight`/`clientHeight` read back zero under `bun test` and every
// assertion here would pass against any implementation at all (drawScrollSpace.test.ts covers
// the pure arithmetic and says the same thing at its head). These run in a real browser under
// bench/playCheck.ts.
//
// The two risks these exist to pin, both of them silent:
//   1. the space leaking into the DOCUMENT (an inserted blank line, a resized fence) rather than
//      staying pure scroller extent — so the document string is snapshotted and compared byte for
//      byte across enter → scroll → regenerate → exit;
//   2. the space OUTLIVING draw mode, leaving a permanently stretched scrollbar — so the exit
//      assertion is exact equality with the height measured before entering, not "smaller".
// And a third, which was a real regression on this feature earlier: the ink overlay reads the
// editor's geometry every paint, so `InkStaysPutWhenTheSpaceAppears` re-samples the committed
// canvas's alpha channel and requires the painted rows to be IDENTICAL, not merely close.

/** The toggle-draw-mode keybinding, as a real keydown. Editor.tsx listens on its own wrapper in
 *  the CAPTURE phase, so this reaches it from any descendant. Never a hardcoded combo — the
 *  settings store is the source of truth, exactly as `matchesKeybinding` requires. */
const toggleDrawMode = (canvasElement: HTMLElement) => {
    const target = canvasElement.querySelector('.cm-content')
    if (!target) throw new Error('no .cm-content to aim the keybinding at')
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'I',
            code: 'KeyI',
            metaKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        }),
    )
}

/** The drawing dock renders only while draw mode is on, and `.draw-toolbar` is a GLOBAL class
 *  (drawing/Toolbar.module.css, kept unhashed there via :global()) rather than a hashed module
 *  local — so it is a safe probe for "the overlay is interactive", where the host's own
 *  `active` class is not. */
const drawModeOn = (canvasElement: HTMLElement) =>
    !!canvasElement.querySelector('.draw-toolbar')

const scrollerOf = (canvasElement: HTMLElement) => {
    const el = canvasElement.querySelector('.cm-scroller') as HTMLElement | null
    if (!el) throw new Error('no .cm-scroller')
    return el
}
const viewOf = (canvasElement: HTMLElement) => {
    const dom = canvasElement.querySelector('.cm-editor')
    const v = dom && EditorView.findFromDOM(dom as HTMLElement)
    if (!v) throw new Error('could not find EditorView')
    return v
}

const A_LOT_OF_PROSE = [
    '# A long note',
    '',
    ...Array.from(
        { length: 60 },
        (_, i) => `Paragraph ${i + 1}, long enough that the note scrolls on its own.`,
    ),
    '',
].join('\n')

// Committed ink, anchored to the paragraph on line 3 (no blank line between, which is what makes
// `scanDrawBlocks` call the fence attached). Real encoded ink, decoded back by the overlay — the
// story seeds no canvas state of its own.
const INK: Stroke[] = [
    { t: 'pen', c: 'fg', w: 5, pts: [40, 2, 200, 240, 8, 200, 440, 3, 200] },
]
const LONG_INKED_NOTE = insertDrawBlock(A_LOT_OF_PROSE, 3, INK)

/** Rows of a canvas that carry ink, in canvas-relative CSS px — the real alpha channel, which is
 *  the only thing that can tell "the ink did not move" from "the canvas happens to be mounted".
 *  (Same probe as InkOverlay.stories.tsx's `inkExtent`, scanning the full width.) */
const inkedRows = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return null
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let top = -1
    let bottom = -1
    let rows = 0
    for (let row = 0; row < canvas.height; row++) {
        let inked = false
        for (let col = 0; col < canvas.width; col++) {
            if (data[(row * canvas.width + col) * 4 + 3] > 16) {
                inked = true
                break
            }
        }
        if (!inked) continue
        rows++
        if (top < 0) top = row
        bottom = row
    }
    return top < 0 ? null : { top, bottom, rows }
}

/** THE RULE: while draw mode is on there is always at least a screenful of empty space below the
 *  end of the note, it regenerates as you scroll into it, the document never changes, and leaving
 *  draw mode gives the scroller its exact original extent back. */
export const DrawModeScrollSpace: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Long.md': A_LOT_OF_PROSE } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Long.md"
                    initialText={A_LOT_OF_PROSE}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = scrollerOf(canvasElement)
        const view = viewOf(canvasElement)
        await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(0))
        // Let CodeMirror finish measuring off-screen line heights before anything is compared
        // against them — a height sampled mid-measure is not the note's natural extent.
        await new Promise(r => setTimeout(r, 400))

        const viewport = scroller.clientHeight
        const natural = scroller.scrollHeight
        const doc = view.state.doc.toString()
        await expect(viewport).toBeGreaterThan(0)
        await expect(natural).toBeGreaterThan(viewport) // the fixture really does scroll

        // ── In and straight back out ────────────────────────────────────────────────────────
        // The exact-return check belongs HERE, before anything scrolls: CodeMirror estimates the
        // height of lines it has not measured, and scrolling through a note replaces those
        // estimates with real measurements — so a note's own natural extent legitimately drifts
        // once you have travelled through it, and an exact comparison after scrolling would be
        // grading the height estimator rather than this feature. Nothing has moved yet, so this
        // is byte-for-byte the same scroller it was a moment ago.
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(true))
        await waitFor(() =>
            expect(scroller.scrollHeight).toBeGreaterThanOrEqual(
                natural + viewport,
            ),
        )
        await expect(view.state.doc.toString()).toBe(doc) // scroll space, not document
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(false))
        await waitFor(() => expect(scroller.scrollHeight).toBe(natural))

        // ── Entering, for real this time ────────────────────────────────────────────────────
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(true))
        await waitFor(() =>
            expect(scroller.scrollHeight).toBeGreaterThanOrEqual(
                natural + viewport,
            ),
        )

        // ── Regenerating, twice in a row ────────────────────────────────────────────────────
        // Each round scrolls to the very bottom of the space the previous round produced; the
        // rule is that doing so always yields still more. Twice, because a single fixed run-off
        // would pass a one-round check and then dead-end.
        let previous = scroller.scrollHeight
        for (let round = 0; round < 2; round++) {
            scroller.scrollTop = scroller.scrollHeight
            await waitFor(() =>
                expect(scroller.scrollHeight).toBeGreaterThan(previous),
            )
            // …and what it yields is a fresh screenful ahead of where the user actually is,
            // not one more pixel.
            await expect(
                scroller.scrollHeight - (scroller.scrollTop + viewport),
            ).toBeGreaterThanOrEqual(viewport)
            previous = scroller.scrollHeight
        }
        await expect(view.state.doc.toString()).toBe(doc)
        const inDrawMode = scroller.scrollHeight

        // ── Leaving, from deep inside the space ─────────────────────────────────────────────
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(false))
        // Two exact checks that do not depend on the height estimator, because a scrollbar left
        // stretched by even a fraction of the space is the second of this feature's two risks:
        // the space is gone at its source…
        const content = canvasElement.querySelector('.cm-content') as HTMLElement
        await waitFor(() =>
            expect(
                Math.round(parseFloat(getComputedStyle(content).paddingBottom)),
            ).toBe(CONTENT_PAD_BOTTOM),
        )
        // …and the scroller carries nothing beyond the content's own box, so no leftover extent
        // hid somewhere else (a spacer, a stretched child, a second padded rule).
        await expect(scroller.scrollHeight).toBe(
            Math.max(scroller.clientHeight, content.offsetHeight),
        )
        // The whole space really was given back, not trimmed.
        await expect(inDrawMode - scroller.scrollHeight).toBeGreaterThanOrEqual(
            2 * viewport,
        )
        await expect(view.state.doc.toString()).toBe(doc)
    },
}

/** The added space must not move a single painted row of committed ink. The overlay reads
 *  `contentDOM`'s live rect on every paint and coalesces through CodeMirror's measure phase, so
 *  extent added at the bottom of the content box is exactly the kind of change that has shifted
 *  ink on this feature before. Sampled from the canvas's alpha channel, at a pinned scrollTop, so
 *  the comparison is of painted pixels and not of a DOM the paint never consulted.
 *
 *  ONE VARIABLE AT A TIME, and this is why the first phase does not use the draw-mode toggle:
 *  entering draw mode also reconfigures `editable`, and turning `contenteditable` off ALREADY
 *  moves this ink down 2 device rows — measured against this same story with the scroll space
 *  compartment forced empty, so it predates the space and is not what is under test here. The
 *  space is therefore applied on its own, through the very custom property the feature drives,
 *  with nothing else about the editor changed. Then the second phase does the real thing and
 *  requires that GROWING the space, over and over, adds no movement at all. */
export const InkStaysPutWhenTheSpaceAppears: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Inked.md': LONG_INKED_NOTE } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Inked.md"
                    initialText={LONG_INKED_NOTE}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = scrollerOf(canvasElement)
        const view = viewOf(canvasElement)
        await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(0))
        await new Promise(r => setTimeout(r, 400))

        // The committed-ink canvas is the FIRST of the overlay's two (base, then live).
        const canvas = canvasElement.querySelectorAll<HTMLCanvasElement>('canvas')[0]
        await expect(canvas).toBeDefined()

        /** The painted ink AND the position of the paragraph it annotates, read together at
         *  scrollTop 0 with a fresh paint forced first. Two things this shape buys:
         *
         *  The nudge — without it a comparison could be reading a canvas nothing had redrawn
         *  since the previous sample, which would make "the ink did not move" true for the wrong
         *  reason: the same nothing-was-actually-checked failure `playCheck`'s SKIP grade exists
         *  to prevent.
         *
         *  The paragraph — ink is anchored to the block it decorates, so the invariant that
         *  actually matters is the OFFSET between the two, not the ink's absolute row. That
         *  distinction is load-bearing here: entering draw mode moves this note's text down 2
         *  device rows all on its own, because CodeMirror's own base theme applies
         *  `-webkit-user-modify: read-write-plaintext-only` under `&[contenteditable=true]` and
         *  draw mode turns `contenteditable` off. Measured against this same story with the
         *  scroll-space compartment forced empty, so it predates the space and is not what is
         *  under test. The ink follows the text faithfully across it, which is what the offset
         *  assertions below pin. */
        const sample = async () => {
            scroller.scrollTop = 40
            await new Promise(r => setTimeout(r, 120))
            scroller.scrollTop = 0
            await new Promise(r => setTimeout(r, 220))
            const rows = inkedRows(canvas)
            if (!rows) throw new Error('no ink on the committed canvas')
            const line = lineWith(canvasElement, /^Paragraph 1,/)
            if (!line) throw new Error('the annotated paragraph is not rendered')
            return {
                ...rows,
                lineTop: Math.round(
                    line.getBoundingClientRect().top -
                        canvas.getBoundingClientRect().top,
                ),
            }
        }
        /** How far the ink sits below the paragraph it belongs to. */
        const glue = (s: Awaited<ReturnType<typeof sample>>) => s.top - s.lineTop

        await waitFor(() => expect(inkedRows(canvas)).not.toBeNull())
        const baseline = await sample()
        const doc = view.state.doc.toString()
        const natural = scroller.scrollHeight
        const viewport = scroller.clientHeight

        // ── Phase 1: the space, and nothing but the space ───────────────────────────────────
        // Driven straight through the property the plugin drives, so `editable`, the overlay's
        // active flag and the toolbar are all held still — one variable, and it is this feature's.
        // Everything is compared IN FULL here: adding three thousand pixels of scroll space must
        // move neither the painted ink nor the text by a single row.
        view.dom.style.setProperty(SCROLL_PAD_VAR, `${CONTENT_PAD_BOTTOM + 3000}px`)
        await waitFor(() =>
            expect(scroller.scrollHeight).toBeGreaterThanOrEqual(
                natural + viewport,
            ),
        )
        await expect({ at: 'space-applied', ...(await sample()) }).toEqual({
            at: 'space-applied',
            ...baseline,
        })
        await expect(view.state.doc.toString()).toBe(doc)
        view.dom.style.removeProperty(SCROLL_PAD_VAR)
        await waitFor(() => expect(scroller.scrollHeight).toBe(natural))
        await expect({ at: 'space-removed', ...(await sample()) }).toEqual({
            at: 'space-removed',
            ...baseline,
        })

        // ── Phase 2: the real toggle, and the space regenerating under it ───────────────────
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(true))
        await waitFor(() =>
            expect(scroller.scrollHeight).toBeGreaterThanOrEqual(
                natural + viewport,
            ),
        )
        const inDrawMode = await sample()
        // Asserted as an OFFSET, not an absolute row — see `sample`'s note on the 2px reflow that
        // turning `contenteditable` off causes on its own. The ink went wherever its paragraph
        // went, and nowhere else.
        await expect({ at: 'entered', glue: glue(inDrawMode) }).toEqual({
            at: 'entered',
            glue: glue(baseline),
        })
        // Grow the space three times over, then come back. Regenerating it must add exactly no
        // movement of its own — absolute rows this time, since nothing else changes here.
        for (let round = 0; round < 3; round++) {
            const before = scroller.scrollHeight
            scroller.scrollTop = scroller.scrollHeight
            await waitFor(() =>
                expect(scroller.scrollHeight).toBeGreaterThan(before),
            )
        }
        await expect({ at: 'after-growth', ...(await sample()) }).toEqual({
            at: 'after-growth',
            ...inDrawMode,
        })
        await expect(view.state.doc.toString()).toBe(doc)

        // Leaving takes the space away again — a several-thousand-pixel geometry change, and the
        // last chance for it to drag the ink off its paragraph.
        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(false))
        await expect({ at: 'after-exit', glue: glue(await sample()) }).toEqual({
            at: 'after-exit',
            glue: glue(baseline),
        })
    },
}

/** A note far shorter than the pane — where the space IS most of the scroller, and where a rule
 *  written against the content's own height instead of the scroller's would hand out 80px instead
 *  of a screenful. Also the commit path: a stroke drawn down in the empty space still lands as a
 *  fence in the note, exactly as it does today. */
const SHORT_NOTE = '# Short\n\nOne line, and a lot of nothing under it.\n'

export const DrawModeScrollSpaceOnAShortNote: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Short.md': SHORT_NOTE } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Short.md"
                    initialText={SHORT_NOTE}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = scrollerOf(canvasElement)
        const view = viewOf(canvasElement)
        await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(0))
        await new Promise(r => setTimeout(r, 400))

        const viewport = scroller.clientHeight
        const natural = scroller.scrollHeight
        // The premise of this story: the note does not scroll at all on its own.
        await expect(natural).toBe(viewport)

        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(true))
        await waitFor(() =>
            expect(scroller.scrollHeight).toBeGreaterThanOrEqual(
                natural + viewport,
            ),
        )

        // Scroll well past the end of the note and draw there. The live canvas is the SECOND of
        // the overlay's two.
        scroller.scrollTop = natural
        await new Promise(r => setTimeout(r, 200))
        const live = canvasElement.querySelectorAll<HTMLCanvasElement>('canvas')[1]
        await expect(live).toBeDefined()
        const r = live.getBoundingClientRect()
        const y = r.top + r.height * 0.6
        const send = (type: string, x: number) =>
            live.dispatchEvent(
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    pointerId: 7,
                    pointerType: 'pen',
                    isPrimary: true,
                    pressure: 0.6,
                }),
            )
        send('pointerdown', r.left + r.width * 0.35)
        for (let i = 1; i <= 8; i++) {
            send('pointermove', r.left + r.width * (0.35 + i * 0.02))
        }
        send('pointerup', r.left + r.width * 0.51)

        // The debounced ink commit lands as a fence in the note — the existing path, unchanged.
        await waitFor(
            () => {
                const blocks = scanDrawBlocks(view.state.doc.toString())
                expect(blocks).toHaveLength(1)
                expect(blocks[0].strokes).toHaveLength(1)
            },
            { timeout: 5000 },
        )
        const inDrawMode = scroller.scrollHeight

        toggleDrawMode(canvasElement)
        await waitFor(() => expect(drawModeOn(canvasElement)).toBe(false))
        // The scroll space is gone: the scroller is back to the note's own extent (which is now
        // taller than it started, because the fence the stroke committed reserves height — that
        // is the document growing, which is a different thing from the space).
        await waitFor(() =>
            expect(inDrawMode - scroller.scrollHeight).toBeGreaterThanOrEqual(
                viewport,
            ),
        )
        const content = canvasElement.querySelector('.cm-content') as HTMLElement
        await expect(
            Math.round(parseFloat(getComputedStyle(content).paddingBottom)),
        ).toBe(CONTENT_PAD_BOTTOM)
    },
}

const TASK_AUTOCOMPLETE_TEXT = [
    '# Task Autocomplete',
    '',
    '- [ ] rent [due',
    '',
].join('\n')

/** Regression for taskComplete.ts's doubled-bracket bug (tasks-mode-and-emoji-removal plan,
 *  Task 4): typing `[due` by hand and accepting the "due date" completion used to insert a
 *  SECOND `[` after the one already on the line, because the keyword arm matched only the
 *  trailing word `due` and left `from` pointing at the `d` rather than the `[`. The fix widens
 *  the match to consume the open bracket too, so accepting REPLACES it instead of sitting
 *  after it. play() drives the real CodeMirror completion commands (startCompletion /
 *  acceptCompletion) rather than calling classifyTaskContext directly, so a regression in the
 *  wiring — not just the pure matcher taskComplete.test.ts already covers — would show up
 *  here too. */
export const TaskFieldAutocomplete: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { 'Task Autocomplete.md': TASK_AUTOCOMPLETE_TEXT },
            }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Task Autocomplete.md"
                    initialText={TASK_AUTOCOMPLETE_TEXT}
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
        view.focus()

        // Caret right after the hand-typed `[due` — no trailing space, matching the bug report.
        const at =
            TASK_AUTOCOMPLETE_TEXT.indexOf('- [ ] rent [due') +
            '- [ ] rent [due'.length
        view.dispatch({ selection: { anchor: at, head: at } })

        // Same two real-CodeMirror timings memoryRefSource.test.ts's openPickerAndWait guards
        // against: the completion pass is debounced, and acceptCompletion ignores input within
        // its 75ms interactionDelay of the popup opening. Both are harness concerns only.
        startCompletion(view)
        for (
            let i = 0;
            i < 100 && completionStatus(view.state) !== 'active';
            i++
        ) {
            await new Promise(r => setTimeout(r, 10))
        }
        await expect(completionStatus(view.state)).toBe('active')
        await new Promise(r => setTimeout(r, 90)) // clear CM's 75ms interactionDelay

        await expect(acceptCompletion(view)).toBe(true)

        const line = view.state.doc.lineAt(at).text
        await expect(line).toBe('- [ ] rent [due ')
        // The doubled-bracket bug produced `[[due ` — pin exactly one open bracket in the
        // DESCRIPTION (the checkbox's own `[ ]` is not the thing under test).
        const description = line.slice(taskDescStart(line)!)
        await expect(description.match(/\[/g)?.length).toBe(1)
    },
}

const REBIND_LINK_TEXT = ['# Rebind Open Completion', '', 'A link to [[P'].join(
    '\n',
)

/** THE proof this task exists for. CodeMirror's `autocompletion()` used to install its OWN
 *  Ctrl-Space keymap at Prec.highest, unconditionally, in front of anything `.settings`
 *  configured — so rebinding `open-completion` away from Ctrl+Space never actually took Ctrl+Space
 *  away. Every `autocompletion()` call site now passes `defaultKeymap: false`, and the popup's
 *  navigation keys are rebuilt by hand in `completionNavKeymap` (completionDisplay.ts), which
 *  deliberately does NOT include Ctrl-Space/Alt-`/Alt-i — opening the popup is `open-completion`'s
 *  job alone. Every key below is a REAL KeyboardEvent dispatched at the contentDOM (never the bare
 *  command function), so a regression that leaves CM's own keymap installed shows up as step 5
 *  going red: Ctrl+Space would still open the popup after the rebind. */
export const RebindOpenCompletion: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { 'Rebind Completion.md': REBIND_LINK_TEXT } }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Rebind Completion.md"
                    initialText={REBIND_LINK_TEXT}
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
        view.focus()

        const at = REBIND_LINK_TEXT.indexOf('[[P') + '[[P'.length
        view.dispatch({ selection: { anchor: at, head: at } })

        const press = (init: KeyboardEventInit) =>
            view.contentDOM.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    ...init,
                }),
            )
        const waitActive = async () => {
            for (
                let i = 0;
                i < 100 && completionStatus(view.state) !== 'active';
                i++
            ) {
                await new Promise(r => setTimeout(r, 10))
            }
            await expect(completionStatus(view.state)).toBe('active')
            await new Promise(r => setTimeout(r, 90)) // clear CM's 75ms interactionDelay
        }

        // 1. DEFAULT settings: Ctrl+Space — a FAITHFUL synthetic shape (key ' ', code 'Space', not
        //    the string "Space") — still opens the popup.
        press({ key: ' ', code: 'Space', ctrlKey: true })
        await waitActive()

        // 2. completionNavKeymap's own bindings still work: ArrowDown/ArrowUp move the selected
        //    row, Escape closes.
        await expect(selectedCompletionIndex(view.state)).toBe(0)
        press({ key: 'ArrowDown', code: 'ArrowDown' })
        await expect(selectedCompletionIndex(view.state)).toBe(1)
        press({ key: 'ArrowUp', code: 'ArrowUp' })
        await expect(selectedCompletionIndex(view.state)).toBe(0)
        press({ key: 'Escape', code: 'Escape' })
        await expect(completionStatus(view.state)).toBeNull()

        // 3. Reopen + Enter accepts the highlighted option (whichever CM ranked first).
        press({ key: ' ', code: 'Space', ctrlKey: true })
        await waitActive()
        const picked = String(
            currentCompletions(view.state)[selectedCompletionIndex(view.state)!]
                .label,
        )
        press({ key: 'Enter', code: 'Enter' })
        await expect(completionStatus(view.state)).toBeNull()
        // Not `[[${picked}]]` verbatim: NOTE_NAMES deliberately has two notes both labeled
        // "Plan" (see its own comment above), so wikilinkOptions.ts inserts a PATH-QUALIFIED
        // target for either one (e.g. `[[Archive/Plan]]`) rather than the bare label — this
        // still proves the picked option landed, tolerant of that qualification.
        await expect(view.state.doc.toString()).toContain(`${picked}]]`)

        // 4. Rebind `open-completion` away from Ctrl+Space.
        const restore = settings.keybindings['open-completion']
        setSettings('keybindings', 'open-completion', 'Ctrl+J')
        await new Promise(r => setTimeout(r, 100)) // let the reactive compartment reconfigure
        try {
            // Reset the buffer back to the unclosed `[[P` so the popup has something to open on.
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: REBIND_LINK_TEXT,
                },
                selection: { anchor: at, head: at },
            })

            // 5. Ctrl+Space must NO LONGER open the popup — the assertion that was impossible
            //    before this task. A generous fixed wait, then settle (not a single sample right
            //    after the keypress — that races CM's `'pending'` intermediate), so a regression
            //    that leaves CM's own keymap on still has time to show up as `active`.
            view.focus()
            press({ key: ' ', code: 'Space', ctrlKey: true })
            await new Promise(r => setTimeout(r, 300))
            await expect(await waitForCompletionSettled(view)).toBeNull()

            // 6. The NEW combo genuinely opens it — the rebind is live, not merely "Ctrl+Space
            //    broke by accident".
            view.focus()
            press({ key: 'j', code: 'KeyJ', ctrlKey: true })
            await waitActive()
            press({ key: 'Escape', code: 'Escape' })
            await expect(completionStatus(view.state)).toBeNull()

            // 7. Empty string leaves NO key able to open the popup.
            setSettings('keybindings', 'open-completion', '')
            await new Promise(r => setTimeout(r, 100))
            view.focus()
            press({ key: 'j', code: 'KeyJ', ctrlKey: true })
            await new Promise(r => setTimeout(r, 300))
            await expect(await waitForCompletionSettled(view)).toBeNull()
            view.focus()
            press({ key: ' ', code: 'Space', ctrlKey: true })
            await new Promise(r => setTimeout(r, 300))
            await expect(await waitForCompletionSettled(view)).toBeNull()
        } finally {
            // The settings store is module-level and shared by every story in the run.
            setSettings('keybindings', 'open-completion', restore)
        }
    },
}

const FRONTMATTER_LINK_TEXT = [
    '---',
    'reference: [source](https://example.com/src), [cleaned up version](https://example.com/clean)',
    'homepage: https://example.com/home',
    'related: [[Another Note]]',
    '---',
    '',
    'Body prose with a [body link](https://example.com/body) so the two paths sit side by side.',
].join('\n')

/** The hidden-syntax collapse holds INSIDE frontmatter, not just in body prose.
 *
 *  livePreview.ts's frontmatter branch runs pushMarkdownLinks / pushWikilinks / pushBareUrls on
 *  property rows "so links in properties read as links" — a second code path that the body-only
 *  `LinkCoverage` story above never exercises. This story is a CHARACTERIZATION of the current,
 *  correct behaviour: it fails the moment anyone adds a `.cm-frontmatter .cm-hidden-syntax`
 *  override that stops the `[`, `](url)` and `[[`/`]]` runs collapsing to zero width.
 *
 *  Context: a user reported "a lot of space after the hyperlink" in exactly this frontmatter
 *  shape. Two investigations measured every hidden run at 0px and attributed the gap entirely to
 *  literal spaces in the note's own source. This story is what makes that measurement permanent.
 *
 *  Reads the OFF-CURSOR state, so no `view.focus()` and no caret placement — compare
 *  RevealedMarks, which must focus because it asserts the REVEALED state instead. */
export const FrontmatterLinkCoverage: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { 'Frontmatter Links.md': FRONTMATTER_LINK_TEXT },
            }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <Editor
                    path="Frontmatter Links.md"
                    initialText={FRONTMATTER_LINK_TEXT}
                    onSaved={noop}
                    noteNames={() => NOTE_NAMES}
                    memoryNames={() => MEMORY_NAMES}
                    tagNames={() => TAG_NAMES}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-frontmatter')) {
                throw new Error('frontmatter panel not rendered yet')
            }
            return true
        })

        const inFm = (sel: string, text: string) =>
            [...canvasElement.querySelectorAll(`.cm-frontmatter ${sel}`)].some(
                el => el.textContent === text,
            )

        // Both markdown links in one property row render as their link TEXT; the URLs stay
        // hidden off-cursor, exactly as in body prose.
        await expect(inFm('.cm-link', 'source')).toBe(true)
        await expect(inFm('.cm-link', 'cleaned up version')).toBe(true)
        // A bare URL property renders in full — nothing to hide.
        await expect(inFm('.cm-link', 'https://example.com/home')).toBe(true)
        // A wikilink property renders as the bare basename.
        await expect(inFm('.cm-wikilink', 'Another Note')).toBe(true)

        // THE INVARIANT: every hidden-syntax run inside frontmatter is genuinely zero-width,
        // not merely small. The length check is load-bearing — without it the loop is vacuous
        // and passes having measured nothing.
        const hidden = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-frontmatter .cm-hidden-syntax',
        )
        await expect(hidden.length).toBeGreaterThan(0)
        for (const el of hidden) {
            await expect(el.getBoundingClientRect().width).toBeLessThan(0.5)
        }
    },
}
