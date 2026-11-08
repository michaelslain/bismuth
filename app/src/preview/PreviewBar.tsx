// app/src/preview/PreviewBar.tsx
// The PREVIEW tab's view bar (images, PDFs, code/text, anything else): ONE ui/ViewBar, every
// control from the Button family (IconButton / TextButton), the same two spacings every other bar
// in the app uses. Left to right:
//
//   identity  file icon + filename (ellipsizes first, never vanishes)
//   readouts  p. N / M (pdf) // W × H (image)
//   config    [− 100% + fit]   [highlight draw scratch]   [dark]   pdf  ·  [− 100% + fit] [draw] on an image
//   actions   [bookmarks]  [open-externally reveal]   pdf only · file actions Tauri
//
// ONE DISTANCE: every pair of neighbouring controls sits ~16.5px apart, ink to ink, inside a group
// and between groups alike; the groups exist for the drop ladder, not as visible gaps. Every icon carries the same
// unpainted bracket room (a plain icon passes IconButton `bracketRoom`, reserving `[ ]` exactly as an
// off toggle does), so the distance never depends on which kind of icon sits where; two adjacent ON
// toggles (e.g. DRAW + SCRATCH) keep ~7px bracket to bracket, never a fused frame. Text (readouts, `fit`) has no bracket room, so its gaps
// are a step wider to land on the same distances (see PreviewBar.module.css, PdfZoom `wide`).
//
// ONE THING MEANS ONE THING. Only a toggle that is ON renders `variant="selected"` (HIGHLIGHT while
// armed, DRAW, SCRATCH, DARK, BOOKMARKS) — accent brackets + accent glyph, no box (Button.module.css draws
// no border for a selected state). FIT is a one-shot command — never selected — and the `%` beside
// it already says whether the page is at fit width. A freshly opened PDF therefore has no control
// in its selected state at all.
//
// NARROW PANES use the shared fit-driven drop only (`data-bar-drop`, ui/ViewBar.tsx): the file
// actions, the zoom steps and DARK are tagged 4 and the page readout 2, and a tagged control leaves
// the bar only when the bar cannot hold it, then lives in the bar's `[≡]` menu (the `.settings`
// default and the palette command still set DARK). FIT, the mode toggles and BOOKMARKS never drop —
// they are the only way into what they open. There is no second row.
import { createSignal, type JSX, Show } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import ReadModeSwitch, { type ReadFlow, type ReadView } from '../bases/ReadModeSwitch'
import FlowToggle from '../bases/FlowToggle'
import BarSettings from '../ui/BarSettings'
import IconButton from '../ui/IconButton'
import Label from '../ui/Label'
import PageReadout from './PageReadout'
import PdfZoom from './PdfZoom'
import HighlightColorMenu from './HighlightColorMenu'
import { PDF_HIGHLIGHT_COLORS } from '../../../core/src/theme/tokens'
import styles from './PreviewBar.module.css'

export type PreviewBarProps = {
    kind: () => 'image' | 'pdf' | 'code' | 'external'
    name: () => string
    /** HEADER_ICON[kind()] */
    icon: () => string
    /** pdf reading position (readouts); omitted/count 0 → no readout */
    currentPage?: () => number
    pageCount?: () => number
    onGoToPage?: (index: number) => void
    /** pdf / image zoom (1 = fit) */
    zoom?: () => number
    onZoomBy?: (factor: number) => void
    onFit?: () => void
    /** annotate (image: draw only; pdf: highlight, draw, scratch) */
    annotReady: () => boolean
    drawMode: () => boolean
    onToggleDraw: () => void
    highlightArmed?: () => boolean
    /** wired with onMouseDown preventDefault inside PreviewBar */
    onHighlight?: () => void
    /** pdf highlighter colour (a PDF_HIGHLIGHT_COLORS `c`); right-clicking HIGHLIGHT opens a menu
     *  of them, and a pick picks it, then presses highlight unless already armed */
    highlightColor?: () => string
    onHighlightColor?: (c: string) => void
    scratchOn?: () => boolean
    onToggleScratch?: () => void
    /** pdf dark mode, remembered per file in its sidecar (`appearance.pdfDarkMode` is the
     *  default); disabled with the annotate tools until the sidecar has loaded */
    darkOn?: () => boolean
    onToggleDark?: () => void
    /** pdf panel */
    panelOpen?: () => boolean
    onTogglePanel?: () => void
    /** the loaded image's natural pixel size; undefined = not loaded / failed / not an image */
    imageSize?: () => { w: number; h: number } | undefined
    /** image / pdf: the reader's two pickers, what it shows and scroll or flip; absent → no pickers */
    reading?: () => { view: ReadView; flow: ReadFlow }
    onReadView?: (view: ReadView) => void
    onReadFlow?: (flow: ReadFlow) => void
    /** native file actions; false → group absent */
    nativeActions: () => boolean
    onOpenExternal: (reveal: boolean) => void
    class?: string
}

export default function PreviewBar(props: PreviewBarProps): JSX.Element {
    const pdf = () => props.kind() === 'pdf'
    const inkable = () => props.kind() === 'image' || pdf()
    /** The highlight button's right-click menu of colours, at the cursor; null = closed. */
    const [colorMenu, setColorMenu] = createSignal<{ x: number; y: number } | null>(null)
    const colorName = () =>
        PDF_HIGHLIGHT_COLORS.find(h => h.c === (props.highlightColor?.() ?? 'hl'))?.name ??
        'yellow'

    return (
        <ViewBar
            class={`${styles.bar} ${props.class ?? ''}`}
            parts={{
                lead: styles.lead,
                identity: styles.identity,
                readouts: styles.readouts,
                config: styles.config,
                actions: styles.actions,
                trail: styles.trail,
            }}
            identity={
                <Crumb icon={props.icon()} class={styles.crumb}>
                    {props.name()}
                </Crumb>
            }
            readouts={
                <>
                    <Show when={pdf() && (props.pageCount?.() ?? 0) > 0}>
                        {/* The least essential thing in the trail: a reading position is worth
                            less than the controls that edit the page. The wrapper carries the tag
                            because PageReadout's props are its interface, not a pass-through. */}
                        <div
                            class={styles.group}
                            data-bar-drop="2"
                            data-bar-menu-label="page"
                        >
                            <PageReadout
                                current={() => props.currentPage?.() ?? 0}
                                count={() => props.pageCount?.() ?? 0}
                                onGo={i => props.onGoToPage?.(i)}
                            />
                        </div>
                    </Show>
                    <Show when={props.kind() === 'image' && props.imageSize?.()}>
                        {size => (
                            <div
                                class={styles.group}
                                data-bar-drop="2"
                                data-bar-menu-label="size"
                            >
                                <Label tone="muted">
                                    {`${size().w} × ${size().h}`}
                                </Label>
                            </div>
                        )}
                    </Show>
                </>
            }
            config={
                <Show when={inkable()}>
                    <Show when={props.reading}>
                        {reading => (
                            <div class={styles.readMode} data-bar-drop="3" data-bar-menu-label="read as">
                                <ReadModeSwitch view={reading()().view} onView={v => props.onReadView?.(v)} />
                            </div>
                        )}
                    </Show>
                    <PdfZoom
                        wide
                        class={styles.afterText}
                        zoom={() => props.zoom?.() ?? 1}
                        onZoomBy={f => props.onZoomBy?.(f)}
                        onFit={() => props.onFit?.()}
                    />
                    <div
                        class={`${styles.tools} ${styles.afterText}`}
                        data-testid="preview-annotate"
                    >
                        <Show when={pdf()}>
                            <IconButton
                                icon="Highlighter"
                                label="Highlight text"
                                title={
                                    props.highlightArmed?.()
                                        ? `Select text to highlight it ${colorName()} (click to cancel, right-click for colours)`
                                        : `Highlight the selected text ${colorName()} (right-click for colours)`
                                }
                                variant={
                                    props.highlightArmed?.()
                                        ? 'selected'
                                        : 'unselected'
                                }
                                disabled={!props.annotReady()}
                                // Keep the PDF's text selection (and focus) where it is — the
                                // press highlights THAT selection.
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => props.onHighlight?.()}
                                // The right-click is this button's own: bubbling on to PaneLeaf
                                // would open the pane menu, which closes this one (activeMenu.ts).
                                onContextMenu={(e: MouseEvent) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (props.annotReady())
                                        setColorMenu({ x: e.clientX, y: e.clientY })
                                }}
                            />
                            <Show when={colorMenu()}>
                                {m => (
                                    <HighlightColorMenu
                                        x={m().x}
                                        y={m().y}
                                        value={props.highlightColor?.() ?? 'hl'}
                                        onPick={c => props.onHighlightColor?.(c)}
                                        onClose={() => setColorMenu(null)}
                                    />
                                )}
                            </Show>
                        </Show>
                        <IconButton
                            icon="Pencil"
                            label="Draw"
                            keybinding="toggle-draw-mode"
                            variant={props.drawMode() ? 'selected' : 'unselected'}
                            disabled={!props.annotReady()}
                            onClick={() => props.onToggleDraw()}
                        />
                        <Show when={pdf()}>
                            <IconButton
                                icon="Notebook"
                                label="Scratch paper"
                                title="Scratch paper beside every page"
                                variant={
                                    props.scratchOn?.() ? 'selected' : 'unselected'
                                }
                                disabled={!props.annotReady()}
                                onClick={() => props.onToggleScratch?.()}
                            />
                        </Show>
                    </div>
                    {/* How the page is shown, not what is done to it, so its own group after
                        the annotate tools. */}
                    <Show when={pdf()}>
                        <div
                            class={styles.tools}
                            data-bar-drop="4"
                            data-bar-menu-label="dark mode"
                        >
                            <IconButton
                                icon="Moon"
                                label="Dark mode"
                                title="Dark mode: invert the pages, keep their colours"
                                variant={props.darkOn?.() ? 'selected' : 'unselected'}
                                disabled={!props.annotReady()}
                                data-testid="preview-dark"
                                onClick={() => props.onToggleDark?.()}
                            />
                        </div>
                    </Show>
                    {/* scroll or flip, set once like a reading app's layout: the same `move by` row
                        the book's `Aa` panel has, behind the bar's settings icon (the viewer has no
                        text size, so no `Aa`) */}
                    <Show when={props.reading}>
                        {reading => (
                            <div class={styles.tools} data-bar-drop="4" data-bar-menu-label="display">
                                <BarSettings
                                    label="display"
                                    rows={[
                                        {
                                            label: 'move by',
                                            control: (
                                                <FlowToggle flow={reading()().flow} onFlow={f => props.onReadFlow?.(f)} />
                                            ),
                                        },
                                    ]}
                                />
                            </div>
                        )}
                    </Show>
                </Show>
            }
            actions={
                <>
                    <Show when={pdf()}>
                        {/* PanelRight's Phosphor glyph (sidebar-simple) draws its panel on the LEFT —
                            mirrored so it reads as the right-hand panel this control opens. `.mirror`
                            only flips the inner svg (PLACEMENT of the glyph, not the button's look —
                            no border/background/padding/size changes here). */}
                        <div class={styles.tools}>
                            <IconButton
                                icon="PanelRight"
                                label="Bookmarks"
                                class={styles.mirror}
                                title="Bookmarks and outline"
                                variant={
                                    props.panelOpen?.() ? 'selected' : 'unselected'
                                }
                                onClick={() => props.onTogglePanel?.()}
                            />
                        </div>
                    </Show>
                    {/* The first thing to go: "open externally" always has another path (the file
                        tree, the OS itself). Icon-only and muted like every other glyph — they are
                        the least used controls in the bar and must not be its loudest. */}
                    <Show when={props.nativeActions()}>
                        <div
                            class={styles.tools}
                            data-bar-drop="4"
                            data-bar-menu-label="file"
                            data-testid="preview-file-actions"
                        >
                            <IconButton
                                icon="ExternalLink"
                                bracketRoom
                                label="Open in default app"
                                title="Open in default app"
                                onClick={() => props.onOpenExternal(false)}
                            />
                            <IconButton
                                icon="FolderOpen"
                                bracketRoom
                                label="Reveal in file manager"
                                title="Reveal in file manager"
                                onClick={() => props.onOpenExternal(true)}
                            />
                        </div>
                    </Show>
                </>
            }
        />
    )
}
