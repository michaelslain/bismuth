// Visual spec for <MarkdownField> — a standalone, always-live inline markdown editor
// bound to a plain string (value + onInput), with zero vault/file coupling. It reuses
// the same `livePreview` CodeMirror extension the note Editor uses, so bold/italic/
// lists/checkboxes/links render rendered-yet-editable, but omits wikilink/tag
// autocomplete, spell-check, math, and embeds — meant for a single small field
// (e.g. a calendar event's description), not a full note surface.
//
// Props: value + onInput (controlled), placeholder?, autofocus?, class?.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import MarkdownField from './MarkdownField'
import type { NoteCandidate } from '../editor/wikilink'
import { settings, setSettings } from '../settings'

const meta = {
    title: 'UI/MarkdownField',
    component: MarkdownField,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MarkdownField>

export default meta
type Story = StoryObj<typeof meta>

// The host owns the visible box (border/background/padding/min-height); MarkdownField
// itself is chromeless. This mirrors how a real call site (e.g. EventModal) would style it.
const fieldBoxStyle = {
    width: '360px',
    'min-height': '90px',
    padding: '10px 12px',
    border: '1px solid var(--border)',
    'border-radius': '8px',
    background: 'var(--surface-1)',
} as const

function Controlled(props: {
    initial?: string
    placeholder?: string
    autofocus?: boolean
    noteNames?: () => NoteCandidate[]
    tagNames?: () => string[]
    notePath?: string | null
}) {
    const [v, setV] = createSignal(props.initial ?? '')
    return (
        <div style={fieldBoxStyle}>
            <MarkdownField
                value={v()}
                onInput={setV}
                placeholder={props.placeholder}
                autofocus={props.autofocus}
                noteNames={props.noteNames}
                tagNames={props.tagNames}
                notePath={props.notePath}
            />
        </div>
    )
}

const NOTE_NAMES: NoteCandidate[] = [
    { label: 'Lecture 7', path: 'Lecture 7.md' },
    { label: 'Lecture 8', path: 'Lecture 8.md' },
]

/** Empty field showing the placeholder. */
export const Placeholder: Story = {
    render: () => <Controlled placeholder="Add a description…" />,
}

/** Filled with live-preview markdown: bold/italic render inline, a checkbox is
 *  interactive, and a link shows as a link — all while remaining editable text. */
export const Filled: Story = {
    render: () => (
        <Controlled
            initial={
                '**Team sync** at 3pm — bring the _quarterly_ notes from [last week](https://example.com/notes).\n\n- [ ] Prep slides\n- [x] Book room'
            }
        />
    ),
}

/** Autofocused on mount (the field grabs the caret immediately). */
export const Autofocused: Story = {
    render: () => <Controlled initial="Focused on mount" autofocus />,
}

/** Typing `[[Lec` opens the SAME `[[wikilink]]` completion popup the note editor uses — proof
 *  that MarkdownField runs the shared `markdownEditingExtensions` stack wired to `noteNames`,
 *  not just that the prop compiles. Every candidate matching the prefix is offered. */
export const WikilinkCompletion: Story = {
    render: () => <Controlled noteNames={() => NOTE_NAMES} />,
    play: async ({ canvasElement }) => {
        const content = canvasElement.querySelector<HTMLElement>('.cm-content')
        if (!content) throw new Error('could not find .cm-content')
        await userEvent.click(content)
        // user-event's `type()` treats `[` as the start of a special-key escape, so a literal `[`
        // is written `[[` — typing the wikilink trigger `[[Lec` means passing `[[[[Lec`.
        await userEvent.type(content, '[[[[Lec')

        // CodeMirror mounts its completion tooltip on `document.body`, a sibling of the story
        // root — not a descendant of `canvasElement` — so the popup search has to go through the
        // owner document, the same reach `completionDisplay.ts`'s theme selectors assume.
        const doc = canvasElement.ownerDocument
        await waitFor(() => {
            if (!doc.querySelector('.cm-tooltip-autocomplete'))
                throw new Error('completion popup did not open')
        })
        const tooltip = doc.querySelector('.cm-tooltip-autocomplete')
        await expect(tooltip?.textContent).toContain('Lecture 7')
        await expect(tooltip?.textContent).toContain('Lecture 8')
    },
}

/** The other half of acceptance 5's completion: `#tag` runs off the same shared stack and the same
 *  `tagNames` prop, so a candidate list that never reaches `vaultCompletion` shows up here. */
export const TagCompletion: Story = {
    render: () => <Controlled tagNames={() => ['physics', 'phonons']} />,
    play: async ({ canvasElement }) => {
        const content = canvasElement.querySelector<HTMLElement>('.cm-content')
        if (!content) throw new Error('could not find .cm-content')
        await userEvent.click(content)
        await userEvent.type(content, '#ph')
        const doc = canvasElement.ownerDocument
        await waitFor(() => {
            if (!doc.querySelector('.cm-tooltip-autocomplete'))
                throw new Error('completion popup did not open')
        })
        await expect(
            doc.querySelector('.cm-tooltip-autocomplete')?.textContent,
        ).toContain('phonons')
    },
}

/** Seeds `**bold**` + a `[[wikilink]]` and proves the note editor's live-preview decorations are
 *  live here too: the wikilink renders as its bare basename, and the bold delimiters collapse to
 *  zero width off-cursor (`.cm-hidden-syntax` — never `display:none`, see livePreview.ts) rather
 *  than sitting in the doc as literal `**` text. */
export const RendersLivePreview: Story = {
    render: () => (
        <Controlled
            initial="**bold** and [[Lecture 7]]"
            noteNames={() => NOTE_NAMES}
        />
    ),
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            if (!canvasElement.querySelector('.cm-wikilink'))
                throw new Error('live-preview decorations not rendered yet')
        })
        await expect(
            canvasElement.querySelector('.cm-wikilink')?.textContent,
        ).toBe('Lecture 7')

        const hidden = canvasElement.querySelectorAll<HTMLElement>(
            '.cm-hidden-syntax',
        )
        await expect(hidden.length).toBeGreaterThan(0)
        for (const el of hidden) {
            await expect(el.getBoundingClientRect().width).toBeLessThan(0.5)
        }
    },
}

/** MarkdownField's own `indent`/`outdent` go through a `settingsKeymapCompartment`
 *  (`fieldKeymap` in MarkdownField.tsx), reconfigured live on a rebind — same proof shape as
 *  CardEditor's `RebindMovesToggleBold`. The default `Tab` combo indents the line, a rebind
 *  moves which combo does that WITHOUT remounting the field, and the old combo goes inert. */
export const RebindMovesIndent: Story = {
    render: () => <Controlled initial="line" />,
    play: async ({ canvasElement }) => {
        const content = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>('.cm-content')
            if (!el) throw new Error('field not mounted yet')
            return el
        })
        const liveView = () => {
            const dom = canvasElement.querySelector('.cm-editor')
            const v = dom && EditorView.findFromDOM(dom as HTMLElement)
            if (!v) throw new Error('could not find EditorView')
            return v
        }
        // Caret at the very start of the line, so indentMore's effect is unambiguous: the line
        // gains one `indentUnit` (MarkdownField.tsx sets it to two spaces).
        liveView().dispatch({ selection: { anchor: 0, head: 0 } })

        const pressTab = () =>
            content.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Tab',
                    code: 'Tab',
                    bubbles: true,
                    cancelable: true,
                }),
            )
        const pressModBracket = () =>
            content.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: ']',
                    code: 'BracketRight',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )

        // Default: Tab indents.
        pressTab()
        await waitFor(() =>
            expect(liveView().state.doc.toString()).toBe('  line'),
        )

        // `settings` is a module-level store shared by every story in the run — restore it no
        // matter how the checks below turn out.
        // `as keyof typeof settings.keybindings` — this branch predates `b4624935` ("derive
        // keybindings settings type from KEYBINDING_CATALOG", merged into `rebindable-keys`/
        // `rebindable-keys-fix-2`/`rebindable-keys-task-7b` but not into this worktree's base),
        // so `Settings['keybindings']` here is still the old hand-written literal that doesn't
        // list `indent`. This is the SAME cast `settingsKeymap.ts`'s `comboFor` already uses
        // today for exactly this gap — not a new hole.
        const KB_INDENT = 'indent' as keyof typeof settings.keybindings
        const previous = settings.keybindings[KB_INDENT]
        setSettings('keybindings', KB_INDENT, 'Mod+]')
        try {
            // Let the compartment's createEffect reconfigure before probing it.
            await new Promise(r => setTimeout(r, 150))

            // OLD combo (Tab): inert now. CodeMirror's own `defaultKeymap` never binds Tab on
            // its own (CM6 deliberately leaves it unbound to avoid trapping focus), so if this
            // still indented, the helper never actually removed the old binding.
            pressTab()
            await new Promise(r => setTimeout(r, 150))
            await expect(liveView().state.doc.toString()).toBe('  line')

            // NEW combo (Mod+]): runs the same command, live, no remount.
            pressModBracket()
            await waitFor(() =>
                expect(liveView().state.doc.toString()).toBe('    line'),
            )
        } finally {
            setSettings('keybindings', KB_INDENT, previous)
        }
    },
}

/** MarkdownField's bold/italic arrive through the SHARED `markdownEditingExtensions` stack
 *  (`cellEditorExtensions.ts`'s `buildSettingsKeymap`, read once when the view's extensions are
 *  built in `onMount`) — not the field's own compartment, unlike `indent`/`outdent` above. This
 *  is a documented, deliberate asymmetry (see the task 5 report), not a bug to paper over: a
 *  rebind of `toggle-bold` does NOT reach an already-mounted field. This story proves both
 *  halves for real — the OLD combo keeps firing and the NEW one is inert while still mounted,
 *  and only a remount (a fresh EditorView instance, asserted below) swaps them. */
export const RebindTogglesBoldOnlyAfterRemount: Story = {
    render: () => {
        const [generation, setGeneration] = createSignal(0)
        return (
            <div>
                <button
                    data-testid="remount"
                    onClick={() => setGeneration(g => g + 1)}
                >
                    remount
                </button>
                {generation() % 2 === 0 ? <Controlled /> : <Controlled />}
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const contentEl = () => {
            const el = canvasElement.querySelector<HTMLElement>('.cm-content')
            if (!el) throw new Error('field not mounted yet')
            return el
        }
        const liveView = () => {
            const dom = canvasElement.querySelector('.cm-editor')
            const v = dom && EditorView.findFromDOM(dom as HTMLElement)
            if (!v) throw new Error('could not find EditorView')
            return v
        }
        await waitFor(() => contentEl())
        const beforeView = liveView()

        const pressModB = () =>
            contentEl().dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'b',
                    code: 'KeyB',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        const pressModY = () =>
            contentEl().dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'y',
                    code: 'KeyY',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )

        // `settings` is a module-level store shared by every story in the run — restore it no
        // matter how the checks below turn out.
        // See RebindMovesIndent above for why this cast is needed on this branch.
        const KB_TOGGLE_BOLD = 'toggle-bold' as keyof typeof settings.keybindings
        const previous = settings.keybindings[KB_TOGGLE_BOLD]
        setSettings('keybindings', KB_TOGGLE_BOLD, 'Mod+Y')
        try {
            await new Promise(r => setTimeout(r, 150))

            // STILL MOUNTED from before the rebind: this instance's keymap was built from
            // settings as they were at mount time, so the OLD combo keeps working...
            pressModB()
            await waitFor(() =>
                expect(liveView().state.doc.toString()).toBe('****'),
            )
            // ...and the NEW combo does nothing yet.
            const mid = liveView()
            mid.dispatch({ changes: { from: 0, to: mid.state.doc.length } })
            pressModY()
            await new Promise(r => setTimeout(r, 150))
            await expect(liveView().state.doc.toString()).toBe('')

            // Force an actual remount — a fresh EditorView instance, not the same one settling.
            const remountBtn = canvasElement.querySelector<HTMLElement>(
                '[data-testid="remount"]',
            )
            if (!remountBtn) throw new Error('remount button missing')
            await userEvent.click(remountBtn)
            await waitFor(() => expect(liveView()).not.toBe(beforeView))

            // AFTER the remount, `markdownEditingExtensions` was rebuilt from CURRENT settings:
            // the OLD combo is now inert...
            pressModB()
            await new Promise(r => setTimeout(r, 150))
            await expect(liveView().state.doc.toString()).toBe('')
            // ...and the NEW combo runs the command.
            pressModY()
            await waitFor(() =>
                expect(liveView().state.doc.toString()).toBe('****'),
            )
        } finally {
            setSettings('keybindings', KB_TOGGLE_BOLD, previous)
        }
    },
}
