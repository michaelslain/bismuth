// app/src/preview/PreviewBar.tsx
// The PREVIEW tab's view bar (images, PDFs, code/text, anything else): ONE ui/ViewBar, every
// control from the Button family (IconButton / TextButton), the same two spacings every other bar
// in the app uses. Left to right:
//
//   identity  file icon + filename (ellipsizes first, never vanishes)
//   readouts  p. N / M (pdf) // W × H (image)
//   config    [− 100% + fit]   [highlight draw scratch]    pdf  ·  [draw] on an image
//   actions   [bookmarks]      [open-externally reveal]    bookmarks pdf only · file actions Tauri
//
// GROUPS ARE SPACING, NOT DIVIDERS. Inside a group controls sit at `--bar-icon-gap`; between groups
// — whether that boundary is ViewBar's own region gap or two groups sharing a region — it is
// `--bar-crumb-gap`. Nothing else: no hand-rolled margins (see PreviewBar.module.css). The one
// exception is the annotate group's own hairline `--sp-1` gap (`.annotate`), which keeps two
// adjacent ON toggles (e.g. DRAW + SCRATCH) from reading as one fused frame.
//
// ONE THING MEANS ONE THING. Only a toggle that is ON renders `variant="selected"` (HIGHLIGHT while
// armed, DRAW, SCRATCH, BOOKMARKS) — accent brackets + accent glyph, no box (Button.module.css draws
// no border for a selected state). FIT is a one-shot command — never selected — and the `%` beside
// it already says whether the page is at fit width. A freshly opened PDF therefore has no control
// in its selected state at all.
//
// NARROW PANES use the shared collapse ladder only (`data-bar-drop`, ui/ViewBar.module.css): the
// file actions and the zoom steps at 4 (650px), the page readout at 2 (500px). FIT, the mode
// toggles and BOOKMARKS never drop — they are the only way into what they open. There is no second
// row.
import { type JSX, Show } from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import IconButton from '../ui/IconButton'
import TextButton from '../ui/TextButton'
import Label from '../ui/Label'
import PageReadout from './PageReadout'
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
    /** pdf zoom */
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
    /** settings.keybindings['toggle-draw-mode'], for the tooltip */
    drawKey: () => string
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
                config: styles.config,
                actions: styles.actions,
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
                    <Show when={props.kind() === 'image' && props.imageSize?.()}>
                        {size => (
                            <div class={styles.group} data-bar-drop="2">
                                <Label tone="muted">{`${size().w} × ${size().h}`}</Label>
                            </div>
                        )}
                    </Show>
                </>
            }
            config={
                <Show when={inkable()}>
                    <Show when={pdf()}>
                        <div class={styles.group} data-testid="pdf-zoom-cluster">
                            {/* Only the steps drop — ctrl/cmd+wheel still zooms there, and FIT stays
                                as the one-click way back to fit width. */}
                            <div
                                class={styles.group}
                                data-bar-drop="4"
                                data-testid="pdf-zoom-steps"
                            >
                                <IconButton
                                    icon="Minus"
                                    label="Zoom out"
                                    title="Zoom out"
                                    onClick={() => props.onZoomBy?.(1 / 1.2)}
                                />
                                <Label tone="muted" class={styles.zoom}>
                                    {`${Math.round((props.zoom?.() ?? 1) * 100)}%`}
                                </Label>
                                <IconButton
                                    icon="Plus"
                                    label="Zoom in"
                                    title="Zoom in"
                                    onClick={() => props.onZoomBy?.(1.2)}
                                />
                            </div>
                            <TextButton
                                title="Fit width"
                                aria-label="Fit width"
                                onClick={() => props.onFit?.()}
                            >
                                fit
                            </TextButton>
                        </div>
                    </Show>
                    <div
                        class={`${styles.group} ${styles.annotate}`}
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
                                aria-pressed={props.highlightArmed?.() ?? false}
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
                            aria-pressed={props.drawMode()}
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
                                aria-pressed={props.scratchOn?.() ?? false}
                                disabled={!props.annotReady()}
                                onClick={() => props.onToggleScratch?.()}
                            />
                        </Show>
                    </div>
                </Show>
            }
            actions={
                <>
                    <Show when={pdf()}>
                        {/* PanelRight's Phosphor glyph (sidebar-simple) draws its panel on the LEFT —
                            mirrored so it reads as the right-hand panel this control opens. `.mirror`
                            only flips the inner svg (PLACEMENT of the glyph, not the button's look —
                            no border/background/padding/size changes here). */}
                        <div class={styles.group}>
                            <IconButton
                                icon="PanelRight"
                                label="Bookmarks"
                                class={styles.mirror}
                                title="Bookmarks and outline"
                                variant={
                                    props.panelOpen?.() ? 'selected' : 'unselected'
                                }
                                aria-pressed={props.panelOpen?.() ?? false}
                                onClick={() => props.onTogglePanel?.()}
                            />
                        </div>
                    </Show>
                    {/* The first thing to go: "open externally" always has another path (the file
                        tree, the OS itself). Icon-only and muted like every other glyph — they are
                        the least used controls in the bar and must not be its loudest. */}
                    <Show when={props.nativeActions()}>
                        <div
                            class={styles.group}
                            data-bar-drop="4"
                            data-testid="preview-file-actions"
                        >
                            <IconButton
                                icon="ExternalLink"
                                label="Open in default app"
                                title="Open in default app"
                                onClick={() => props.onOpenExternal(false)}
                            />
                            <IconButton
                                icon="FolderOpen"
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
