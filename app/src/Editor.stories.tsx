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
