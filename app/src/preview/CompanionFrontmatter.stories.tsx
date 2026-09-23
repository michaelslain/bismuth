// Visual spec for <CompanionFrontmatter> — the tag-carrying companion note's frontmatter strip,
// mounted under PreviewView's ViewBar for image/pdf kinds (see PreviewView.stories.tsx's Image
// and Pdf stories for that mount-point wiring). Exercised directly here, over a fake `api.read`/
// `api.writeChecked` transport, so these stories prove the strip's OWN load/edit/write/fold
// behaviour without depending on an image or PDF actually rendering.
//
// NOTE-IDENTICAL BY RULING (Task 1): this strip no longer forks livePreview's own frontmatter
// chrome — it matches the note editor directly (CompanionFrontmatter.module.css only adds the
// line-height/padding needed to reproduce Editor.tsx's own scroller, nothing that restyles
// livePreview.ts). `MatchesNoteFrontmatter` below proves that by mounting a real note `Editor` on
// the SAME frontmatter text next to the strip and comparing their computed styles directly.
//
// SIMULATING A KEYSTROKE: MarkdownField is a CodeMirror 6 field (a contenteditable div, not an
// <input>), so `fireEvent.input` can't drive it the way it drives the plain <input> find bar in
// PreviewView.stories.tsx. Editor.stories.tsx's own pattern is the one to copy: resolve the LIVE
// EditorView off the mounted `.cm-editor` DOM node via `EditorView.findFromDOM`, then
// `view.dispatch({ changes: {...} })` directly — that's a real doc edit through CodeMirror's own
// transaction system, which fires MarkdownField's `updateListener` (`u.docChanged` -> `onInput`)
// exactly as a keystroke would.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { Accessor } from 'solid-js'
import { createSignal } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { EditorView } from '@codemirror/view'
import CompanionFrontmatter from './CompanionFrontmatter'
import createCompanionStore from './createCompanionStore'
import { companionPathFor } from '../../../core/src/fileKinds'
import { Editor } from '../Editor'
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { settings } from '../settings'
import styles from './CompanionFrontmatter.module.css'
import foldedFenceStyles from './FoldedFence.module.css'

/** Builds a real CompanionStore under this story's own Solid owner (createCompanionStore.ts) and
 *  hands it to CompanionFrontmatter as `store` — same "an already-owned store" path PreviewView
 *  will use from task 4 on, exercised here instead of the `binaryPath`-only fallback so these
 *  stories prove the store integration, not just the component's own defaulting. */
function Host(props: {
    binaryPath: Accessor<string>
    tagNames: () => string[]
    foldKey?: string
}) {
    const store = createCompanionStore(props.binaryPath)
    return (
        <CompanionFrontmatter
            store={store}
            tagNames={props.tagNames}
            foldKey={props.foldKey}
        />
    )
}

const meta = {
    title: 'Preview/CompanionFrontmatter',
    component: CompanionFrontmatter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CompanionFrontmatter>

export default meta
type Story = StoryObj<typeof meta>

const NO_TAGS = () => [] as string[]
const noop = () => {}

/** The live CM6 EditorView mounted inside an element — same helper Editor.stories.tsx uses to
 *  drive a real doc edit instead of trying to synthesize contenteditable DOM events. */
function liveView(root: HTMLElement): EditorView {
    const dom = root.querySelector('.cm-editor')
    const v = dom && EditorView.findFromDOM(dom as HTMLElement)
    if (!v) throw new Error('could not find EditorView')
    return v
}

/** Approximates a `::before` pseudo-element's viewport rect from its host line's own rect plus
 *  the pseudo's OWN computed `left`/`top`/`width`/`height` (all resolved to px by the browser,
 *  even for an `em`-relative value like codeLineNumbers.ts's `left: -2.7em`) — a pseudo has no DOM
 *  node of its own to call `getBoundingClientRect()` on, so this is the only way to get its
 *  geometry. `top`/`left` default to `auto` here (only `left` is set in codeLineNumberTheme), so
 *  an unset one falls back to the line's own edge, its static position. */
function pseudoRect(line: HTMLElement, pseudo: '::before' | '::after') {
    const lineRect = line.getBoundingClientRect()
    const cs = getComputedStyle(line, pseudo)
    const left = lineRect.left + (cs.left === 'auto' ? 0 : parseFloat(cs.left))
    const top = lineRect.top + (cs.top === 'auto' ? 0 : parseFloat(cs.top))
    const width = cs.width === 'auto' ? 0 : parseFloat(cs.width)
    const height = cs.height === 'auto' ? lineRect.height : parseFloat(cs.height)
    return { left, top, right: left + width, bottom: top + height }
}

/** No companion note exists yet for this binary. */
export const NoCompanion: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        return <Host binaryPath={() => 'photo.png'} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Lazy creation (plan "Design"): a fresh binary shows the EMPTY_FRONTMATTER template —
        // 'tags: []' — not a blank field.
        await waitFor(() =>
            expect(canvas.getByText(/tags/)).toBeInTheDocument(),
        )
        // No write happened just from rendering the strip and leaving it alone — the companion
        // must not spring into existence merely because an image was opened. Waited past the
        // debounce (settings.editor.autoSaveDelay) so this can't pass on a write still in flight.
        await new Promise(r =>
            setTimeout(r, settings.editor.autoSaveDelay + 200),
        )
        await expect(await api.read(companionPathFor('photo.png'))).toBe('')
    },
}

const EXISTING_PATH = 'photo.png.md'
const EXISTING_TEXT = '---\ntags: [trip, 2026]\n---\nA note about the trip.\n'

/** An existing companion with tags AND a hand-written body — both tags render, and typing a new
 *  one writes a companion whose text still carries the body untouched. */
export const ExistingCompanionWithBody: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { [EXISTING_PATH]: EXISTING_TEXT } }),
        )
        return <Host binaryPath={() => 'photo.png'} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        // Both existing tags render.
        await waitFor(() => {
            expect(canvasElement.textContent).toContain('trip')
            expect(canvasElement.textContent).toContain('2026')
        })

        // Type a third tag by editing the live CM doc directly (see the file header) — insert
        // right before the closing `]` of the tags array.
        const view = liveView(canvasElement)
        const doc = view.state.doc.toString()
        const insertAt = doc.indexOf(']')
        await expect(insertAt).toBeGreaterThan(-1)
        view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: ', summer' },
        })
        await waitFor(() =>
            expect(canvasElement.textContent).toContain('summer'),
        )

        // Note-identical sizing (Task 1) must never clip a real line of tags — a strip with 3
        // tags still shows all of them. Find the TEXT NODE carrying "summer" (via a Range, not an
        // element query — CodeMirror's own syntax-highlighter spans nest arbitrarily, so no
        // element is guaranteed to have exactly this textContent) and check it renders at a real,
        // unclipped size fully inside the panel's own box.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const walker = document.createTreeWalker(
                panel,
                NodeFilter.SHOW_TEXT,
            )
            let summerNode: Text | null = null
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (n.textContent?.includes('summer')) {
                    summerNode = n as Text
                    break
                }
            }
            expect(summerNode).toBeTruthy()
            const range = document.createRange()
            range.selectNodeContents(summerNode!)
            const tagRect = range.getBoundingClientRect()
            const panelRect = panel.getBoundingClientRect()
            expect(tagRect.height).toBeGreaterThan(0)
            expect(tagRect.bottom).toBeLessThanOrEqual(panelRect.bottom + 1)
            expect(tagRect.top).toBeGreaterThanOrEqual(panelRect.top - 1)
        })

        // Past the debounce, the write landed AND the hand-written body is still there —
        // companionDoc.ts's joinCompanion never touches the body half.
        await waitFor(
            async () => {
                const written = await api.read(EXISTING_PATH)
                expect(written).toContain('summer')
                expect(written).toContain('A note about the trip.')
            },
            { timeout: settings.editor.autoSaveDelay + 2000 },
        )
    },
}

/** Switching to a different binary drops the old companion's text immediately — no stale tags
 *  bleeding across a tab switch (the task's "reacts to binaryPath changes" requirement). */
export const SwitchesBinaryPath: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    'a.png.md': '---\ntags: [alpha]\n---\n',
                    'b.png.md': '---\ntags: [beta]\n---\n',
                },
            }),
        )
        const [path, setPath] = createSignal('a.png')
        return (
            <div>
                <button
                    type="button"
                    data-testid="switch-to-b"
                    onClick={() => setPath('b.png')}
                >
                    switch to b.png
                </button>
                <Host binaryPath={path} tagNames={NO_TAGS} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvasElement.textContent).toContain('alpha'),
        )
        await expect(canvasElement.textContent).not.toContain('beta')

        await fireEvent.click(canvas.getByTestId('switch-to-b'))

        // The OLD binary's tag is gone as soon as the new companion loads — never a stale frame
        // showing "alpha" (or a stale "beta" if this ran the other way) while the switch settles.
        await waitFor(() => expect(canvasElement.textContent).toContain('beta'))
        await expect(canvasElement.textContent).not.toContain('alpha')
    },
}

const MATCH_TEXT = '---\ntags: [trip, 2026]\n---\n'

/** Proves the strip is note-identical (Task 1's whole point) by mounting a real note `Editor` on
 *  the SAME frontmatter text right next to the strip, then comparing their computed styles
 *  directly rather than against a hand-copied number — a drift in either side shows up here
 *  first. Also proves the in-block gutter number, suppressed by the old fork, is back and sits
 *  inside the strip (Review Focus #3: the number hangs at `-2.7em`, close to this strip's own
 *  left edge). */
export const MatchesNoteFrontmatter: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [EXISTING_PATH]: MATCH_TEXT, 'Match.md': MATCH_TEXT },
            }),
        )
        return (
            <div>
                <div data-testid="strip">
                    <Host binaryPath={() => 'photo.png'} tagNames={NO_TAGS} />
                </div>
                <div data-testid="editor" style={{ height: '300px' }}>
                    <Editor
                        path="Match.md"
                        initialText={MATCH_TEXT}
                        onSaved={noop}
                        noteNames={() => []}
                        memoryNames={() => []}
                        tagNames={() => []}
                    />
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const strip = canvas.getByTestId('strip')
        const editor = canvas.getByTestId('editor')

        // Generous timeout: this story mounts a full note Editor (Harper, embeds, the whole
        // extension stack) ALONGSIDE the strip in one page, and a loaded parallel playCheck run
        // (several Chrome tabs at once) can push its first paint past the default wait window.
        // Diagnostic throws (not `.not.toBeNull()`) so a timeout names WHICH side never rendered.
        await waitFor(
            () => {
                if (!strip.querySelector('.cm-frontmatter'))
                    throw new Error('strip: .cm-frontmatter not found')
            },
            { timeout: 5000 },
        )
        await waitFor(
            () => {
                if (!editor.querySelector('.cm-frontmatter'))
                    throw new Error('editor: .cm-frontmatter not found')
            },
            { timeout: 5000 },
        )

        const closeEnough = (a: number, b: number) =>
            expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5)

        // Property-row font-size + line-height.
        await waitFor(() => {
            const stripLine = strip.querySelector(
                '.cm-frontmatter',
            ) as HTMLElement
            const editorLine = editor.querySelector(
                '.cm-frontmatter',
            ) as HTMLElement
            const s = getComputedStyle(stripLine)
            const e = getComputedStyle(editorLine)
            closeEnough(parseFloat(s.fontSize), parseFloat(e.fontSize))
            closeEnough(parseFloat(s.lineHeight), parseFloat(e.lineHeight))
        })

        // Fence-row (`.cm-block-top`) padding.
        await waitFor(() => {
            const stripFence = strip.querySelector(
                '.cm-block-top',
            ) as HTMLElement
            const editorFence = editor.querySelector(
                '.cm-block-top',
            ) as HTMLElement
            const s = getComputedStyle(stripFence)
            const e = getComputedStyle(editorFence)
            for (const prop of [
                'paddingTop',
                'paddingRight',
                'paddingBottom',
                'paddingLeft',
            ] as const) {
                closeEnough(parseFloat(s[prop]), parseFloat(e[prop]))
            }
        })

        // `.cm-block-mid`'s `::after` fill colour (the block's flat background).
        await waitFor(() => {
            const stripMid = strip.querySelector(
                '.cm-block-mid',
            ) as HTMLElement
            const editorMid = editor.querySelector(
                '.cm-block-mid',
            ) as HTMLElement
            const s = getComputedStyle(stripMid, '::after').backgroundColor
            const e = getComputedStyle(editorMid, '::after').backgroundColor
            expect(s).toBe(e)
        })

        // No rounding anywhere in the block (ruling: note frontmatter is flat) — checked on the
        // `::after` fill itself (nothing ever rounds `.cm-block-mid` directly; the flat fill lives
        // entirely in the pseudo, so a check against the LINE's own `borderRadius` could never
        // fail regardless of what the fill does).
        await waitFor(() => {
            for (const sel of [
                '.cm-block-top',
                '.cm-block-mid',
                '.cm-block-bottom',
            ]) {
                const stripLine = strip.querySelector(sel) as HTMLElement
                const editorLine = editor.querySelector(sel) as HTMLElement
                expect(
                    getComputedStyle(stripLine, '::after').borderRadius,
                ).toBe('0px')
                expect(
                    getComputedStyle(editorLine, '::after').borderRadius,
                ).toBe('0px')
            }
        })

        // Fence-glyph colour, property-key colour and block left padding — strip vs editor.
        await waitFor(() => {
            const stripFenceSyntax = strip.querySelector(
                '.cm-fence-syntax',
            ) as HTMLElement
            const editorFenceSyntax = editor.querySelector(
                '.cm-fence-syntax',
            ) as HTMLElement
            expect(getComputedStyle(stripFenceSyntax).color).toBe(
                getComputedStyle(editorFenceSyntax).color,
            )

            // `.cm-fm-key`, not `.cm-fm-key > span` — CodeMirror only nests an inner highlight
            // span when a syntax token wins inside the mark (see livePreview.ts ~1919-1924); a
            // plain key like `tags` has no such child, and `.cm-fm-key` itself already carries
            // the colour rule either way.
            const stripKey = strip.querySelector('.cm-fm-key') as HTMLElement
            const editorKey = editor.querySelector('.cm-fm-key') as HTMLElement
            expect(getComputedStyle(stripKey).color).toBe(
                getComputedStyle(editorKey).color,
            )

            const stripMid = strip.querySelector(
                '.cm-block-mid',
            ) as HTMLElement
            const editorMid = editor.querySelector(
                '.cm-block-mid',
            ) as HTMLElement
            expect(getComputedStyle(stripMid).paddingLeft).toBe(
                getComputedStyle(editorMid).paddingLeft,
            )
        })

        // The `---` text's own left edge sits 40px (this panel's own left padding) + 0.5em (the
        // fence row's own left padding, `.cm-block-top`'s `0.15em 0.5em`) from the strip's left
        // edge — the same offset a note's frontmatter fence sits at (measured today 46.75px).
        await waitFor(() => {
            const panel = strip.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const fenceTop = strip.querySelector(
                '.cm-block-top',
            ) as HTMLElement
            const walker = document.createTreeWalker(
                fenceTop,
                NodeFilter.SHOW_TEXT,
            )
            let dashNode: Text | null = null
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (n.textContent?.includes('---')) {
                    dashNode = n as Text
                    break
                }
            }
            expect(dashNode).toBeTruthy()
            const range = document.createRange()
            range.selectNodeContents(dashNode!)
            const textLeft = range.getBoundingClientRect().left
            const panelLeft = panel.getBoundingClientRect().left
            const expected =
                40 + 0.5 * parseFloat(getComputedStyle(fenceTop).fontSize)
            expect(
                Math.abs(textLeft - panelLeft - expected),
            ).toBeLessThanOrEqual(0.5)
        })

        // Finding 1: the chevron sits vertically centred on the opening `---` row.
        await waitFor(() => {
            const chev = within(strip)
                .getByLabelText('fold frontmatter')
                .getBoundingClientRect()
            const fenceTop = strip
                .querySelector('.cm-block-top')!
                .getBoundingClientRect()
            expect(
                Math.abs(
                    chev.top + chev.height / 2 - (fenceTop.top + fenceTop.height / 2),
                ),
            ).toBeLessThanOrEqual(1)
        })

        // The in-block gutter number is BACK (the old fork suppressed it) and non-empty on both
        // sides.
        await waitFor(() => {
            const stripNum = strip.querySelector(
                '.cm-code-numbered',
            ) as HTMLElement
            const editorNum = editor.querySelector(
                '.cm-code-numbered',
            ) as HTMLElement
            expect(stripNum).not.toBeNull()
            expect(editorNum).not.toBeNull()
            const s = getComputedStyle(stripNum, '::before')
            expect(s.display).not.toBe('none')
            expect(s.content).not.toBe('none')
            expect(s.content).not.toBe('""')
        })

        // Review Focus #3: the number's rect sits inside the strip's own root rect — it must not
        // clip past the strip's left edge the way it did in the pre-Task-1 8px-padding panel.
        await waitFor(() => {
            const panel = strip.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const numberedLine = panel.querySelector(
                '.cm-code-numbered',
            ) as HTMLElement
            const panelRect = panel.getBoundingClientRect()
            const numRect = pseudoRect(numberedLine, '::before')
            expect(numRect.left).toBeGreaterThanOrEqual(panelRect.left - 1)
            expect(numRect.right).toBeLessThanOrEqual(panelRect.right + 1)
        })
    },
}

/** Folded: the chevron collapses the strip to FoldedFence's single `--- … ---` row, landing
 *  exactly where the opening fence row sat before the fold (Review Focus: findings 2 + 3). */
export const Folded: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { [EXISTING_PATH]: MATCH_TEXT } }),
        )
        return <Host binaryPath={() => 'photo.png'} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByLabelText('fold frontmatter')).toBeInTheDocument(),
        )

        // Record the UNFOLDED opening fence row's own rect + height, and the panel's own padding,
        // before folding — these are what the folded row must land back on.
        const panel = canvasElement.querySelector(
            `.${styles['companion-frontmatter']}`,
        ) as HTMLElement
        const fenceTopBeforeFold = panel
            .querySelector('.cm-block-top')!
            .getBoundingClientRect()
        const fenceH = fenceTopBeforeFold.height
        const panelPaddingTop = parseFloat(
            getComputedStyle(panel).paddingTop,
        )

        await fireEvent.click(canvas.getByLabelText('fold frontmatter'))

        await waitFor(() => {
            const chevron = canvas.getByLabelText('unfold frontmatter')
            expect(chevron).toHaveAttribute('aria-expanded', 'false')
        })
        await waitFor(() =>
            expect(canvas.getByText('--- … ---')).toBeInTheDocument(),
        )

        // The field is hidden and the folded fence lands where the opening fence row was, at its
        // own unfolded height, and the panel itself shrinks to match (findings 2 + 3).
        await waitFor(() => {
            const field = panel.querySelector(`.${styles.field}`) as HTMLElement
            expect(getComputedStyle(field).display).toBe('none')

            const foldedFenceEl = panel.querySelector(
                `.${foldedFenceStyles['folded-fence']}`,
            ) as HTMLElement
            const foldedRect = foldedFenceEl.getBoundingClientRect()
            const chevRect = canvas
                .getByLabelText('unfold frontmatter')
                .getBoundingClientRect()

            // Chevron centre == FoldedFence root's own centre, ±1px.
            expect(
                Math.abs(
                    chevRect.top +
                        chevRect.height / 2 -
                        (foldedRect.top + foldedRect.height / 2),
                ),
            ).toBeLessThanOrEqual(1)

            // FoldedFence root's top == the unfolded `.cm-block-top`'s own top, ±1px.
            expect(
                Math.abs(foldedRect.top - fenceTopBeforeFold.top),
            ).toBeLessThanOrEqual(1)

            // FoldedFence itself keeps the fence row's own height.
            expect(
                Math.abs(foldedRect.height - fenceH),
            ).toBeLessThanOrEqual(1)

            // The panel shrinks to exactly: fence height + FoldedFence's 6px margin-top + its own
            // top/bottom padding (read off the live element, no literal).
            expect(
                Math.abs(
                    panel.getBoundingClientRect().height -
                        (fenceH + 6 + 2 * panelPaddingTop),
                ),
            ).toBeLessThanOrEqual(1)
        })
    },
}

/** Fold state is remembered per `foldKey`, never shared across a different key — a harness that
 *  switches `foldKey` A -> B -> A and expects each key's own fold state back (Review Focus #2). */
export const FoldRememberedPerKey: Story = {
    render: () => {
        setTransport(
            fakeTransport({ files: { [EXISTING_PATH]: MATCH_TEXT } }),
        )
        const keyA = `story-fold-a-${Date.now()}`
        const keyB = `story-fold-b-${Date.now()}`
        const [key, setKey] = createSignal(keyA)
        return (
            <div>
                <button
                    type="button"
                    data-testid="to-b"
                    onClick={() => setKey(keyB)}
                >
                    switch to b
                </button>
                <button
                    type="button"
                    data-testid="to-a"
                    onClick={() => setKey(keyA)}
                >
                    switch to a
                </button>
                <Host
                    binaryPath={() => 'photo.png'}
                    tagNames={NO_TAGS}
                    foldKey={key()}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByLabelText('fold frontmatter')).toBeInTheDocument(),
        )
        // Fold key A.
        await fireEvent.click(canvas.getByLabelText('fold frontmatter'))
        await waitFor(() =>
            expect(
                canvas.getByLabelText('unfold frontmatter'),
            ).toBeInTheDocument(),
        )

        // Switch to key B: opens fresh, unfolded.
        await fireEvent.click(canvas.getByTestId('to-b'))
        await waitFor(() =>
            expect(
                canvas.getByLabelText('fold frontmatter'),
            ).toBeInTheDocument(),
        )

        // Back to key A: still folded, as left.
        await fireEvent.click(canvas.getByTestId('to-a'))
        await waitFor(() =>
            expect(
                canvas.getByLabelText('unfold frontmatter'),
            ).toBeInTheDocument(),
        )
    },
}

/** Folding and unfolding never write anything — the companion's own persistence stays untouched
 *  by a purely visual toggle, even against a missing companion (Acceptance #5). */
export const FoldWritesNothing: Story = {
    render: () => {
        setTransport(fakeTransport({ files: {} }))
        return <Host binaryPath={() => 'photo.png'} tagNames={NO_TAGS} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getByLabelText('fold frontmatter')).toBeInTheDocument(),
        )
        await fireEvent.click(canvas.getByLabelText('fold frontmatter'))
        await waitFor(() =>
            expect(
                canvas.getByLabelText('unfold frontmatter'),
            ).toBeInTheDocument(),
        )
        await fireEvent.click(canvas.getByLabelText('unfold frontmatter'))
        await waitFor(() =>
            expect(
                canvas.getByLabelText('fold frontmatter'),
            ).toBeInTheDocument(),
        )

        await new Promise(r =>
            setTimeout(r, settings.editor.autoSaveDelay + 200),
        )
        await expect(await api.read(companionPathFor('photo.png'))).toBe('')
    },
}
