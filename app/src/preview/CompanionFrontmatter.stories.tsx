// Visual spec for <CompanionFrontmatter> — the tag-carrying companion note's frontmatter strip,
// mounted under PreviewView's ViewBar for image/pdf kinds (see PreviewView.stories.tsx's Image
// and Pdf stories for that mount-point wiring). Exercised directly here, over a fake `api.read`/
// `api.writeChecked` transport, so these stories prove the strip's OWN load/edit/write behaviour
// without depending on an image or PDF actually rendering.
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
import { api, setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { settings } from '../settings'
import styles from './CompanionFrontmatter.module.css'

/** Builds a real CompanionStore under this story's own Solid owner (createCompanionStore.ts) and
 *  hands it to CompanionFrontmatter as `store` — same "an already-owned store" path PreviewView
 *  will use from task 4 on, exercised here instead of the `binaryPath`-only fallback so these
 *  stories prove the store integration, not just the component's own defaulting. */
function Host(props: {
    binaryPath: Accessor<string>
    tagNames: () => string[]
}) {
    const store = createCompanionStore(props.binaryPath)
    return <CompanionFrontmatter store={store} tagNames={props.tagNames} />
}

const meta = {
    title: 'Preview/CompanionFrontmatter',
    component: CompanionFrontmatter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CompanionFrontmatter>

export default meta
type Story = StoryObj<typeof meta>

const NO_TAGS = () => [] as string[]

/** WCAG relative luminance of an sRGB colour (same formula PreviewView.stories.tsx uses for its
 *  highlight-contrast probe — duplicated here rather than imported, since story files are each
 *  their own self-contained spec, not a shared module). */
function luminance(r: number, g: number, b: number): number {
    const f = (c: number) => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a: number, b: number) =>
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
/** Parses BOTH computed-colour syntaxes a browser may hand back: legacy `rgb()`/`rgba()` and the
 *  `color(srgb r g b / a)` form Chrome resolves `color-mix()` results to (0-1 per channel, scaled
 *  here to 0-255 to match). Returns alpha too (default 1) — needed below because a `color-mix(...,
 *  transparent)` used value keeps its ORIGINAL rgb and reports a reduced alpha rather than
 *  pre-blending against whatever sits behind it; the actual painted colour still has to be
 *  composited by hand. */
const rgbaOf = (css: string): [number, number, number, number] => {
    const rgb = css.match(/rgba?\(([^)]+)\)/)
    if (rgb) {
        const [r, g, b, a] = rgb[1].split(',').map(v => parseFloat(v))
        return [r ?? NaN, g ?? NaN, b ?? NaN, a ?? 1]
    }
    const fn = css.match(
        /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/,
    )
    if (fn) {
        const [r, g, b] = fn.slice(1, 4).map(v => parseFloat(v) * 255)
        return [r, g, b, fn[4] !== undefined ? parseFloat(fn[4]) : 1]
    }
    return [NaN, NaN, NaN, NaN]
}
const rgbOf = (css: string): [number, number, number] =>
    rgbaOf(css).slice(0, 3) as [number, number, number]
/** Composites a (possibly translucent) foreground colour over an opaque background, so contrast
 *  is measured against what actually paints, not the foreground's own unblended channel values. */
const compositeOver = (
    fg: [number, number, number, number],
    bg: [number, number, number],
): [number, number, number] => {
    const [r, g, b, a] = fg
    return [
        a * r + (1 - a) * bg[0],
        a * g + (1 - a) * bg[1],
        a * b + (1 - a) * bg[2],
    ]
}

/** The element actually carrying a line's rendered text colour — walks down through any
 *  single-child wrapper (CodeMirror nests a syntax-highlighter token span inside some marks) so
 *  the colour read back is the one that really paints, not an outer mark a token span overrides. */
function renderedTextColor(el: Element): string {
    let node = el
    while (
        node.children.length === 1 &&
        node.textContent === node.children[0].textContent
    ) {
        node = node.children[0]
    }
    return getComputedStyle(node).color
}

/** Each numbered line's text left edge — `.getBoundingClientRect().left` plus that line's own
 *  resolved `padding-left`, so a fence row and a property row are compared at their actual text
 *  start, not their (possibly differently-padded) box edge. */
function textLeftEdge(line: HTMLElement): number {
    const cs = getComputedStyle(line)
    return line.getBoundingClientRect().left + parseFloat(cs.paddingLeft)
}

/** The live CM6 EditorView mounted inside the strip, or throws — same helper Editor.stories.tsx
 *  uses to drive a real doc edit instead of trying to synthesize contenteditable DOM events. */
function liveView(canvasElement: HTMLElement): EditorView {
    const dom = canvasElement.querySelector('.cm-editor')
    const v = dom && EditorView.findFromDOM(dom as HTMLElement)
    if (!v) throw new Error('could not find EditorView')
    return v
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
        // Compact by default (final review — this used to render ~110px tall: three
        // full-prose-sized rows for a bare `---`/`tags: []`/`---` template). Measured on the
        // panel's own root (the div `ui/Frontmatter` renders), not a descendant, so the number
        // includes its padding — the ruling's "empty default block <= 64px tall" is about the
        // whole visible strip, not just the text.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            expect(panel).not.toBeNull()
            expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(64)
        })
        // Equal top/bottom padding (final review) — `ui/Frontmatter`'s own padding shorthand
        // already gives top/bottom the same value; assert it numerically rather than by reading
        // the CSS, since a future change to either could silently unbalance it.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const cs = getComputedStyle(panel)
            const top = parseFloat(cs.paddingTop)
            const bottom = parseFloat(cs.paddingBottom)
            expect(Math.abs(top - bottom)).toBeLessThanOrEqual(2)
        })
        // No line's glyphs render clipped (final review — the fence rows used to render partially
        // outside their own box at a too-tight line-height): every VISIBLE `.cm-line`'s rect must
        // sit fully inside `.cm-content`'s own rect. The trailing blank line is `display: none`
        // (CompanionFrontmatter.module.css), so it is correctly excluded rather than asserted at
        // (0,0) which would trivially "pass" without proving anything.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const content = panel.querySelector('.cm-content') as HTMLElement
            const contentRect = content.getBoundingClientRect()
            const lines = Array.from(
                content.querySelectorAll<HTMLElement>('.cm-line'),
            ).filter(l => getComputedStyle(l).display !== 'none')
            expect(lines.length).toBeGreaterThan(0)
            for (const line of lines) {
                const r = line.getBoundingClientRect()
                expect(r.height).toBeGreaterThan(0)
                expect(r.top).toBeGreaterThanOrEqual(contentRect.top - 0.5)
                expect(r.bottom).toBeLessThanOrEqual(contentRect.bottom + 0.5)
            }
        })
        // Exactly one accent-coloured left edge (final review — livePreview's own per-line
        // accent box-shadow duplicated `ui/Frontmatter`'s panel border, reading as a double rule).
        // Resolves `--accent` to its canonical `rgb(...)` computed form (a probe element, since
        // `getPropertyValue('--accent')` returns the raw token string, e.g. a hex code, which
        // never string-matches a computed `rgb(...)` color) and counts every element (including
        // `::after` pseudo-elements, where the livePreview box-shadow actually lives) whose
        // left border or box-shadow resolves to that colour.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const probe = document.createElement('div')
            probe.style.color = 'var(--accent)'
            document.body.appendChild(probe)
            const accentRgb = getComputedStyle(probe).color
            probe.remove()

            let count = 0
            for (const el of [
                panel,
                ...Array.from(panel.querySelectorAll('*')),
            ]) {
                const cs = getComputedStyle(el)
                if (
                    cs.borderLeftStyle !== 'none' &&
                    parseFloat(cs.borderLeftWidth) > 0 &&
                    cs.borderLeftColor === accentRgb
                )
                    count++
                if (cs.boxShadow.includes(accentRgb)) count++
                const after = getComputedStyle(el, '::after')
                if (after.boxShadow.includes(accentRgb)) count++
            }
            expect(count).toBe(1)
        })
        // No stray in-block gutter number (final review — "1" rendered to the left of the accent
        // edge). livePreview's `.cm-code-numbered::before` is suppressed inside this field
        // (CompanionFrontmatter.module.css); assert the pseudo is genuinely gone on every numbered
        // line, not merely that no "1" text NODE exists (a ::before has no DOM node to query for
        // text — reading its computed style is the only way to prove it isn't painted).
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const numbered = panel.querySelectorAll('.cm-code-numbered')
            expect(numbered.length).toBeGreaterThan(0)
            for (const el of Array.from(numbered))
                expect(getComputedStyle(el, '::before').display).toBe('none')
        })
        // The tags: line's text starts at the SAME left edge as the --- fence lines (final review
        // — the fence rows' compaction pass zeroed their horizontal padding without zeroing (or
        // matching) the property row's, so the tags text sat 0.5em right of the fences above/below
        // it). ±1px for subpixel rounding.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const fence = panel.querySelector('.cm-block-top') as HTMLElement
            const tags = panel.querySelector('.cm-frontmatter') as HTMLElement
            expect(fence).not.toBeNull()
            expect(tags).not.toBeNull()
            expect(
                Math.abs(textLeftEdge(fence) - textLeftEdge(tags)),
            ).toBeLessThanOrEqual(1)
        })
        // Fence glyph contrast >= 3:1 against the strip's own background (final review — "they are
        // structure, but must be legible"). livePreview's default 30%-opacity fence dimming reads
        // fine inside a full note page but fell under WCAG's non-text floor measured against this
        // panel's own surface (as low as ~1.8:1 in Paper) — raised to 60% scoped to this field.
        await waitFor(() => {
            const panel = canvasElement.querySelector(
                `.${styles['companion-frontmatter']}`,
            ) as HTMLElement
            const fence = panel.querySelector('.cm-fence-syntax') as HTMLElement
            expect(fence).not.toBeNull()
            const bg = rgbOf(getComputedStyle(panel).backgroundColor)
            const fg = compositeOver(rgbaOf(renderedTextColor(fence)), bg)
            const ratio = contrastRatio(luminance(...bg), luminance(...fg))
            expect(ratio).toBeGreaterThanOrEqual(3)
        })
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

        // The compact sizing above (CompanionFrontmatter.module.css) must never clip a real line
        // of tags — a strip with 3 tags still shows all of them. Find the TEXT NODE carrying
        // "summer" (via a Range, not an element query — CodeMirror's own syntax-highlighter spans
        // nest arbitrarily, so no element is guaranteed to have exactly this textContent) and check
        // it renders at a real, unclipped size fully inside the panel's own box: nothing here
        // imposes a fixed height or `overflow: hidden`, but assert it rather than assume it, since
        // that's exactly the failure mode a future max-height would cause.
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
