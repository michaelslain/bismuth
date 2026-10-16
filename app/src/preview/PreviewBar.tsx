// app/src/preview/PreviewBar.tsx
// The PREVIEW tab's view bar (images, PDFs, code/text, anything else): ONE ui/ViewBar, every
// control from the Button family (IconButton / TextButton), the same two spacings every other bar
// in the app uses. Left to right:
//
//   identity  file icon + filename (ellipsizes first, never vanishes)
//   readouts  p. N / M (pdf) + `// converting to markdown [ cancel ]` while it runs // W × H (image)
//   config    [− 100% + fit]   [highlight draw scratch]   [dark]   pdf  ·  [− 100% + fit] [draw] on an image
//   actions   [to markdown] [bookmarks]  [open-externally reveal]   pdf only · file actions Tauri
//
// GROUPS ARE SPACING, NOT DIVIDERS, and the bar has exactly two visible distances, ink to ink:
// ~16.5px between neighbours inside a group, ~24.5px across a group seam. Every icon carries the same
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
// NARROW PANES use the shared collapse ladder only (`data-bar-drop`, ui/ViewBar.module.css): the
// file actions, the zoom steps and DARK at 4 (650px; the `.settings` default and its palette
// command still set it), the page readout at 2 (500px). FIT, the mode
// toggles and BOOKMARKS never drop — they are the only way into what they open. There is no second
// row.
import { type JSX, Show } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import IconButton from '../ui/IconButton'
import TextButton from '../ui/TextButton'
import Label from '../ui/Label'
import Text from '../ui/Text'
import PageReadout from './PageReadout'
import PdfZoom from './PdfZoom'
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
    scratchOn?: () => boolean
    onToggleScratch?: () => void
    /** pdf dark mode, remembered per file in its sidecar (`appearance.pdfDarkMode` is the
     *  default); disabled with the annotate tools until the sidecar has loaded */
    darkOn?: () => boolean
    onToggleDark?: () => void
    /** settings.keybindings['toggle-draw-mode'], for the tooltip */
    drawKey: () => string
    /** pdf → markdown: true while the conversion runs (the button is disabled, a readout says so) */
    converting?: () => boolean
    onConvert?: () => void
    /** stop the running conversion; no note is written */
    onCancelConvert?: () => void
    /** pdf panel */
    panelOpen?: () => boolean
    onTogglePanel?: () => void
    /** the loaded image's natural pixel size; undefined = not loaded / failed / not an image */
    imageSize?: () => { w: number; h: number } | undefined
    /** native file actions; false → group absent */
    nativeActions: () => boolean
    onOpenExternal: (reveal: boolean) => void
    class?: string
}

export default function PreviewBar(props: PreviewBarProps): JSX.Element {
    const pdf = () => props.kind() === 'pdf'
    const inkable = () => props.kind() === 'image' || pdf()

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
                        <div class={styles.group} data-bar-drop="2">
                            <PageReadout
                                current={() => props.currentPage?.() ?? 0}
                                count={() => props.pageCount?.() ?? 0}
                                onGo={i => props.onGoToPage?.(i)}
                            />
                        </div>
                    </Show>
                    {/* After the page readout, `//` between them (the app's one separator), so the
                        two never read as one phrase; the `//` drops with the readout at level 2.
                        The words shorten to `converting` but stay, so `[ cancel ]` never reads as
                        cancelling whatever control sits next to it; it never drops, since it is
                        the only way to stop the run. */}
                    <Show when={pdf() && props.converting?.()}>
                        <div class={styles.group} data-testid="preview-converting">
                            <Label tone="muted">
                                <Show when={(props.pageCount?.() ?? 0) > 0}>
                                    <Text as="span" inherit data-bar-drop="2">{'// '}</Text>
                                </Show>
                                <BarLabel long="converting to markdown" short="converting" />
                            </Label>
                            <TextButton
                                title="Stop converting; no note is written"
                                data-testid="preview-convert-cancel"
                                onClick={() => props.onCancelConvert?.()}
                            >
                                cancel
                            </TextButton>
                        </div>
                    </Show>
                    <Show when={props.kind() === 'image' && props.imageSize?.()}>
                        {size => (
                            <div class={styles.group} data-bar-drop="2">
                                <Label tone="muted" class={styles.readout}>
                                    {`${size().w} × ${size().h}`}
                                </Label>
                            </div>
                        )}
                    </Show>
                </>
            }
            config={
                <Show when={inkable()}>
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
                                        ? 'Select text to highlight it (click to cancel)'
                                        : 'Highlight the selected text'
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
                            />
                        </Show>
                        <IconButton
                            icon="Pencil"
                            label="Draw"
                            title={`Draw (${props.drawKey()})`}
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
                        <div class={styles.tools} data-bar-drop="4">
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
                            {/* A new note beside the PDF, `x.pdf` → `x.md`; the PDF is untouched.
                                Minutes on a long file, so it stays disabled while it runs and the
                                readout says so. Drops with the file actions at level 4: the file
                                tree's PDF and `bismuth pdf md` are other ways in. */}
                            <IconButton
                                icon="FileText"
                                bracketRoom
                                label="Convert to markdown"
                                title={
                                    props.converting?.()
                                        ? 'Converting to markdown…'
                                        : 'Convert to a markdown note beside this PDF'
                                }
                                disabled={props.converting?.() ?? false}
                                data-testid="preview-convert"
                                data-bar-drop="4"
                                onClick={() => props.onConvert?.()}
                            />
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
