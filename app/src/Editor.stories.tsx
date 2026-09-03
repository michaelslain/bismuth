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
import { fakeTransport } from './ui/_fakeTransport'
import { expectProseFace } from './ui/_proseFace'
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
