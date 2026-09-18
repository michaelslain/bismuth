// app/src/preview/PreviewBar.tsx
// The PREVIEW tab's view bar (images, PDFs, code/text, anything else): ONE ui/ViewBar, every
// control a `VBtn`, the same two spacings every other bar in the app uses. Left to right:
//
//   identity  file icon + filename (ellipsizes first, never vanishes)
//   readouts  `p. N / M`                                   pdf only
//   config    [− 100% + FIT]   [highlight draw scratch]    pdf  ·  [draw] on an image
//   actions   [bookmarks]      [open-externally reveal]    bookmarks pdf only · file actions Tauri
//
// GROUPS ARE SPACING, NOT DIVIDERS. Inside a group controls sit at `--bar-icon-gap`; between groups
// — whether that boundary is ViewBar's own region gap or two groups sharing a region — it is
// `--bar-crumb-gap`. Nothing else: no hand-rolled margins (see PreviewBar.module.css). The one
// exception is the annotate group's own hairline `--sp-1` gap (`.annotate`), which keeps two
// adjacent ON toggles (e.g. DRAW + SCRATCH) from reading as one fused frame.
//
// ONE FRAME MEANS ONE THING. Only a toggle that is ON wears `active` (HIGHLIGHT while armed, DRAW,
// SCRATCH, BOOKMARKS). FIT is a one-shot command — `VBtn`'s own doc forbids `active` on those — and
// the `%` beside it already says whether the page is at fit width. A freshly opened PDF therefore
// paints no accent frame at all.
//
// NARROW PANES use the shared collapse ladder only (`data-bar-drop`, ui/ui.css): the file actions
// and the zoom steps at 4 (650px), the page readout at 2 (500px). FIT, the mode toggles and
// BOOKMARKS never drop — they are the only way into what they open. There is no second row.
import { type JSX, Show, splitProps } from 'solid-js'
import ViewBar, { Crumb, VBtn } from '../ui/ViewBar'
import Label from '../ui/Label'
import Text from '../ui/Text'
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
    /** native file actions; false → group absent */
    nativeActions: () => boolean
    onOpenExternal: (reveal: boolean) => void
    class?: string
}

/** Every glyph in the bar, matching the flashcards bar's `iconSize={13}`. */
const GLYPH = 13

/** An icon-only toggle or command: squared to --h-control by the module's `.icon`. */
function IconVBtn(
    props: {
        icon: string
        label: string
        mirror?: boolean
    } & Omit<Parameters<typeof VBtn>[0], 'icon' | 'iconSize' | 'class'>,
) {
    const [own, rest] = splitProps(props, ['icon', 'label', 'mirror'])
    return (
        <VBtn
            {...rest}
            icon={own.icon}
            iconSize={GLYPH}
            aria-label={own.label}
            class={`${styles.icon} ${own.mirror ? styles.mirror : ''}`}
        />
    )
}

export default function PreviewBar(props: PreviewBarProps): JSX.Element {
    const pdf = () => props.kind() === 'pdf'
    const inkable = () => props.kind() === 'image' || pdf()

    return (
        <ViewBar
            class={`${styles.bar} ${props.class ?? ''}`}
            identity={<Crumb icon={props.icon()}>{props.name()}</Crumb>}
            readouts={
                <Show when={pdf() && (props.pageCount?.() ?? 0) > 0}>
                    {/* The least essential thing in the trail: a reading position is worth less
                        than the controls that edit the page. The wrapper carries the tag because
                        PageReadout's props are its interface, not a pass-through. */}
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        class={styles.group}
                        data-bar-drop="2"
                    >
                        <PageReadout
                            current={() => props.currentPage?.() ?? 0}
                            count={() => props.pageCount?.() ?? 0}
                            onGo={i => props.onGoToPage?.(i)}
                        />
                    </Text>
                </Show>
            }
            config={
                <Show when={inkable()}>
                    <Show when={pdf()}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles.group}
                            data-testid="pdf-zoom-cluster"
                        >
                            {/* Only the steps drop — ctrl/cmd+wheel still zooms there, and FIT stays
                                as the one-click way back to fit width. */}
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles.group}
                                data-bar-drop="4"
                                data-testid="pdf-zoom-steps"
                            >
                                <IconVBtn
                                    icon="Minus"
                                    label="Zoom out"
                                    title="Zoom out"
                                    onClick={() => props.onZoomBy?.(1 / 1.2)}
                                />
                                <Label tone="muted" class={styles.zoom}>
                                    {`${Math.round((props.zoom?.() ?? 1) * 100)}%`}
                                </Label>
                                <IconVBtn
                                    icon="Plus"
                                    label="Zoom in"
                                    title="Zoom in"
                                    onClick={() => props.onZoomBy?.(1.2)}
                                />
                            </Text>
                            <VBtn
                                class={styles.fit}
                                title="Fit width"
                                aria-label="Fit width"
                                onClick={() => props.onFit?.()}
                            >
                                FIT
                            </VBtn>
                        </Text>
                    </Show>
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        class={`${styles.group} ${styles.annotate}`}
                        data-testid="preview-annotate"
                    >
                        <Show when={pdf()}>
                            <IconVBtn
                                icon="Highlighter"
                                label="Highlight text"
                                title={
                                    props.highlightArmed?.()
                                        ? 'Select text to highlight it (click to cancel)'
                                        : 'Highlight the selected text'
                                }
                                active={props.highlightArmed?.() ?? false}
                                aria-pressed={props.highlightArmed?.() ?? false}
                                disabled={!props.annotReady()}
                                // Keep the PDF's text selection (and focus) where it is — the
                                // press highlights THAT selection.
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => props.onHighlight?.()}
                            />
                        </Show>
                        <IconVBtn
                            icon="Pencil"
                            label="Draw"
                            title={`Draw (${props.drawKey()})`}
                            active={props.drawMode()}
                            aria-pressed={props.drawMode()}
                            disabled={!props.annotReady()}
                            onClick={() => props.onToggleDraw()}
                        />
                        <Show when={pdf()}>
                            <IconVBtn
                                icon="Notebook"
                                label="Scratch paper"
                                title="Scratch paper beside every page"
                                active={props.scratchOn?.() ?? false}
                                aria-pressed={props.scratchOn?.() ?? false}
                                disabled={!props.annotReady()}
                                onClick={() => props.onToggleScratch?.()}
                            />
                        </Show>
                    </Text>
                </Show>
            }
            actions={
                <>
                    <Show when={pdf()}>
                        {/* PanelRight's Phosphor glyph (sidebar-simple) draws its panel on the LEFT —
                            mirrored so it reads as the right-hand panel this control opens. */}
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles.group}
                        >
                            <IconVBtn
                                icon="PanelRight"
                                label="Bookmarks"
                                mirror
                                title="Bookmarks and outline"
                                active={props.panelOpen?.() ?? false}
                                aria-pressed={props.panelOpen?.() ?? false}
                                onClick={() => props.onTogglePanel?.()}
                            />
                        </Text>
                    </Show>
                    {/* The first thing to go: "open externally" always has another path (the file
                        tree, the OS itself). Icon-only and muted like every other glyph — they are
                        the least used controls in the bar and must not be its loudest. */}
                    <Show when={props.nativeActions()}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles.group}
                            data-bar-drop="4"
                            data-testid="preview-file-actions"
                        >
                            <IconVBtn
                                icon="ExternalLink"
                                label="Open in default app"
                                title="Open in default app"
                                onClick={() => props.onOpenExternal(false)}
                            />
                            <IconVBtn
                                icon="FolderOpen"
                                label="Reveal in file manager"
                                title="Reveal in file manager"
                                onClick={() => props.onOpenExternal(true)}
                            />
                        </Text>
                    </Show>
                </>
            }
        />
    )
}
