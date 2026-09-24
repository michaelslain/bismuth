// app/src/drawing/Toolbar.tsx
import { Show, type JSX } from 'solid-js'
import type { PaperBg } from '../../../core/src/drawing/model'
import type { ToolState } from './DrawingCanvas'
import { ZOOM_MIN, ZOOM_MAX } from './DrawingPage'
import { Button } from '../ui/Button'
import PlainButton from '../ui/PlainButton'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import { Icon } from '../icons/Icon'
import { CATEGORY_SWATCHES, resolveAppearance } from '../themes'
import { settings } from '../settings'
import styles from './Toolbar.module.css'

const TOOLS: { id: ToolState['tool']; icon: string; title: string }[] = [
    { id: 'pen', icon: 'Pen', title: 'Pen' },
    { id: 'hl', icon: 'Highlighter', title: 'Highlighter' },
    { id: 'eraser', icon: 'Eraser', title: 'Eraser' },
]
// Hand-drawn rather than an <Icon>: the icon set carries no lasso/marquee mark, and the
// neighbouring size/colour/smoothing segments in this bar are inline SVG for the same reason.
// A dashed box with a grab dot on the corner reads as "select, then move or resize".
// A FUNCTION, not a constant, for the same reason its neighbours are: module-level JSX in Solid
// builds one DOM node, so two note panes each showing an ink toolbar would fight over the same
// <svg> and it would disappear from whichever rendered first.
const lassoMark = () => (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
        <rect
            x="3.5"
            y="2.5"
            width="13"
            height="11"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-dasharray="3 2"
        />
        <rect x="14" y="11" width="4" height="4" fill="currentColor" />
    </svg>
)

// Five discrete size levels (≈20% steps) replacing the size slider.
const SIZE_LEVELS = [2, 5, 9, 14, 20]
// Smoothing has two modes: a sharp (raw jagged) path vs. a smooth (relaxed) curve.
const SHARP_PATH = 'M2 13 L6 3 L10 13 L14 3 L18 13 L22 3'
const SMOOTH_PATH = 'M2 9 C8 4 16 14 22 7'

const dotIcon = (size: number) => (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
        <circle cx="11" cy="8" r={2 + (size / 20) * 5} fill="currentColor" />
    </svg>
)
// A color swatch in the identical 22×16 box as dotIcon — a FLAT 16px square (no
// rounding), matching the register's "token swatches, butted in a single --border
// frame" (bismuth-design/ascii-extended PORTING.md §2c / view-sheets-draw.card.html .sw-c).
const colorSwatch = (fill: string) => (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
        <rect x="3" y="0" width="16" height="16" fill={fill} />
    </svg>
)
const smoothIcon = (d: string) => (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
        <path
            d={d}
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
    </svg>
)
// Paper-type icons depict the actual background (blank sheet / ruled / grid / dot grid).
const paperIcon = (bg: PaperBg): JSX.Element => {
    const stroke = {
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.4',
        'stroke-linecap': 'round',
    } as const
    if (bg === 'blank')
        return (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <rect
                    x="3.5"
                    y="2.5"
                    width="11"
                    height="13"
                    rx="1.5"
                    {...stroke}
                />
            </svg>
        )
    if (bg === 'lines')
        return (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <g {...stroke}>
                    <line x1="3" y1="6" x2="15" y2="6" />
                    <line x1="3" y1="9" x2="15" y2="9" />
                    <line x1="3" y1="12" x2="15" y2="12" />
                </g>
            </svg>
        )
    if (bg === 'grid')
        return (
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <g {...stroke} stroke-width="1.2">
                    <line x1="3" y1="7" x2="15" y2="7" />
                    <line x1="3" y1="11" x2="15" y2="11" />
                    <line x1="7" y1="3" x2="7" y2="15" />
                    <line x1="11" y1="3" x2="11" y2="15" />
                </g>
            </svg>
        )
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <g fill="currentColor">
                {[5, 9, 13].flatMap(y =>
                    [5, 9, 13].map(x => <circle cx={x} cy={y} r="1" />),
                )}
            </g>
        </svg>
    )
}

export function Toolbar(props: {
    tools: () => ToolState
    setTools: (patch: Partial<ToolState>) => void
    // Paper background, zoom, and image import are page-drawing concerns; the note-ink overlay
    // reuses this bar without them (no paper, no zoom, attachments already handle images), so
    // each group is optional — DrawingPage passes everything and is unchanged.
    bg?: () => PaperBg
    setBackground?: (bg: PaperBg) => void
    // Note ink adds a LASSO segment (select ink, then move or resize it inside its own block).
    // Opt-in for the same reason `bg`/`zoom` are: the page drawing surface has no selection
    // model, and a control that does nothing is worse than no control.
    lasso?: boolean
    onUndo: () => void
    onRedo: () => void
    zoom?: () => number
    onZoomIn?: () => void
    onZoomOut?: () => void
    onResetZoom?: () => void
    onImportImage?: () => void
    // Override for the "Default ink" swatch preview: PageInk (fix 1) paints onto a light/paper
    // page, not the app's own dark chrome, so its "fg" resolves to the paper ink color — not the
    // live app theme every other caller of this bar tracks. Omitted, the swatch follows
    // `settings.appearance` as before (DrawingPage, InkOverlay).
    fgColor?: string
}) {
    const t = props.tools
    // The five-swatch ink set the register specifies: default ink + accent + three
    // category hues (bismuth-design/ascii-extended PORTING.md §2c: "--fg --accent --rose --gold
    // --green"). The STORED value stays either the "fg" sentinel (resolved live to the
    // active theme's ink at render time — core/src/drawing/theme.ts resolveInkColor) or a
    // literal hex, exactly as before: a stroke's color is persisted into the .draw JSON
    // and re-rendered by the HEADLESS server-side exporter (core/src/drawing/render2d.ts,
    // no DOM/CSS engine there) as well as this canvas, so anything but "fg" must already
    // be a concrete color — never a CSS var() and never a bare id like "accent"/"rose".
    // "fg"/accent are read off the LIVE active scope (settings.appearance.theme), not a
    // frozen DEFAULT_THEME snapshot, so the swatch preview follows a theme switch; the
    // three category hues are intentionally scope-INVARIANT (CATEGORY_SWATCHES is the one
    // fixed teal→rose ramp every categorical surface in the app shares — tokens.ts).
    const activeTheme = () => resolveAppearance(settings.appearance)
    const SWATCHES = () => [
        { id: 'fg', name: 'Default ink' },
        {
            id: activeTheme().accent ?? activeTheme().foreground,
            name: 'accent',
        },
        { id: CATEGORY_SWATCHES.rose, name: 'rose' },
        { id: CATEGORY_SWATCHES.gold, name: 'gold' },
        { id: CATEGORY_SWATCHES.green, name: 'green' },
    ]
    const swatchColor = (c: string) =>
        c === 'fg' ? (props.fgColor ?? activeTheme().foreground) : c

    const toolOpts = () => [
        ...TOOLS.map(x => ({
            id: x.id,
            label: (<Icon value={x.icon} />) as JSX.Element,
            title: x.title,
        })),
        ...(props.lasso
            ? [
                  {
                      id: 'lasso' as ToolState['tool'],
                      label: lassoMark(),
                      title: 'Lasso',
                  },
              ]
            : []),
    ]
    // Colors render as filled flat-square swatches drawn in the SAME 22×16 box as the
    // size dots, so the color row and the line-weight row are identical in size + spacing.
    const colorOpts = () =>
        SWATCHES().map(s => ({
            id: s.id,
            label: colorSwatch(swatchColor(s.id)),
            title: s.name,
        }))
    const sizeOpts = SIZE_LEVELS.map(s => ({
        id: s,
        label: dotIcon(s),
        title: `Size ${s}`,
    }))
    const smoothOpts: {
        id: ToolState['smoothMode']
        label: JSX.Element
        title: string
    }[] = [
        { id: 'sharp', label: smoothIcon(SHARP_PATH), title: 'Sharp (raw)' },
        {
            id: 'smooth',
            label: smoothIcon(SMOOTH_PATH),
            title: 'Smooth (relax on release)',
        },
    ]
    const paperOpts = (['blank', 'lines', 'grid', 'dots'] as PaperBg[]).map(
        p => ({
            id: p,
            label: paperIcon(p),
            title: p[0].toUpperCase() + p.slice(1),
        }),
    )

    const zoomPct = () => Math.round((props.zoom?.() ?? 1) * 100)

    return (
        // `data-draw-toolbar` is the real cross-file contract: `*.stories.tsx` probes outside
        // this task's file list, InkOverlay.module.css and PageInk.module.css all select on the
        // attribute, not the class — so `.draw-toolbar` itself is free to be a plain hashed
        // local, same as any other component's own root class.
        <div class={styles['draw-toolbar']} data-draw-toolbar>
            {/* Two-row dock: most groups stack into a 2-row column to keep the bar narrow.
          tools | colors/sizes | smooth/paper | undo-redo/zoom. */}
            <div class={styles['draw-row']}>
                <div class={styles['draw-group']}>
                    <SegmentedToggle
                        look="icon"
                        options={toolOpts()}
                        value={t().tool}
                        onChange={id => props.setTools({ tool: id })}
                    />
                    {/* Place a picture into the drawing (also reachable via paste + drag-drop onto the stage). */}
                    <Show when={props.onImportImage}>
                        <Button
                            kind="segment"
                            state="unselected"
                            title="Import image"
                            aria-label="Import image"
                            onClick={() => props.onImportImage!()}
                        >
                            <Icon value="ImagePlus" />
                        </Button>
                    </Show>
                </div>
                {/* Colors on top, line-weight directly below — same box size + spacing. */}
                <div class={styles['draw-group']}>
                    <div class={styles['draw-vstack']}>
                        <SegmentedToggle
                            look="swatch"
                            options={colorOpts()}
                            value={t().color}
                            onChange={c => props.setTools({ color: c })}
                        />
                        <SegmentedToggle
                            look="icon"
                            options={sizeOpts}
                            value={t().size}
                            onChange={s => props.setTools({ size: s })}
                            class={styles['draw-vstack-seg']}
                        />
                    </div>
                </div>
                {/* Smoothing on top, paper below (paper only when the surface has one — not note ink). */}
                <div class={styles['draw-group']}>
                    <div class={styles['draw-vstack']}>
                        <SegmentedToggle
                            look="icon"
                            options={smoothOpts}
                            value={t().smoothMode}
                            onChange={v => props.setTools({ smoothMode: v })}
                            class={styles['draw-vstack-seg']}
                        />
                        <Show when={props.bg && props.setBackground}>
                            <SegmentedToggle
                                look="icon"
                                options={paperOpts}
                                value={props.bg!()}
                                onChange={id => props.setBackground!(id)}
                                class={styles['draw-vstack-seg']}
                            />
                        </Show>
                    </div>
                </div>
                {/* Undo/redo on top, zoom below. */}
                <div class={styles['draw-group']}>
                    <div class={styles['draw-vstack']}>
                        {/* Undo/redo are two independent commands, not a mutually-exclusive pair
                            with an active member — SegmentedToggle's `value` accepts `undefined`
                            for exactly this (one-global-followups Task 3), so neither segment is
                            ever "selected" and this composes the real component instead of a raw
                            duplicate of its markup. */}
                        <SegmentedToggle
                            look="icon"
                            value={undefined}
                            onChange={id =>
                                id === 'undo' ? props.onUndo() : props.onRedo()
                            }
                            class={styles['draw-vstack-seg']}
                            options={[
                                {
                                    id: 'undo' as const,
                                    label: <Icon value="Undo2" />,
                                    title: 'Undo',
                                    ariaLabel: 'Undo',
                                },
                                {
                                    id: 'redo' as const,
                                    label: <Icon value="Redo2" />,
                                    title: 'Redo',
                                    ariaLabel: 'Redo',
                                },
                            ]}
                        />
                        <Show
                            when={
                                props.zoom &&
                                props.onZoomIn &&
                                props.onZoomOut &&
                                props.onResetZoom
                            }
                        >
                            <div class={styles['draw-zoomrow']}>
                                <SegmentedToggle
                                    look="icon"
                                    value={undefined}
                                    onChange={() => props.onZoomOut!()}
                                    class={styles['draw-vstack-seg']}
                                    options={[
                                        {
                                            id: 'out' as const,
                                            label: (
                                                <Icon
                                                    value="ZoomOut"
                                                />
                                            ),
                                            title: 'Zoom out',
                                            ariaLabel: 'Zoom out',
                                            disabled:
                                                props.zoom!() <= ZOOM_MIN,
                                        },
                                    ]}
                                />
                                {/* A ui/PlainButton (unstyled real <button>), not a SegmentedToggle
                                    option — this is a readout, not a toggle member, so it must
                                    never pick up a Button KIND class (bracket-buttons Task 2). Its
                                    look is `.draw-zoompct` alone, colocated below. */}
                                <PlainButton
                                    class={styles['draw-zoompct']}
                                    title="Reset zoom"
                                    aria-label="Reset zoom"
                                    onClick={() => props.onResetZoom!()}
                                >
                                    {`${zoomPct()}%`}
                                </PlainButton>
                                <SegmentedToggle
                                    look="icon"
                                    value={undefined}
                                    onChange={() => props.onZoomIn!()}
                                    class={styles['draw-vstack-seg']}
                                    options={[
                                        {
                                            id: 'in' as const,
                                            label: (
                                                <Icon
                                                    value="ZoomIn"
                                                />
                                            ),
                                            title: 'Zoom in',
                                            ariaLabel: 'Zoom in',
                                            disabled:
                                                props.zoom!() >= ZOOM_MAX,
                                        },
                                    ]}
                                />
                            </div>
                        </Show>
                    </div>
                </div>
            </div>
        </div>
    )
}
