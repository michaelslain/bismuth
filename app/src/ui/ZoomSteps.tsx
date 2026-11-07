// app/src/ui/ZoomSteps.tsx
// The one zoom-step shape `− 100% +`: two bare icon buttons around a muted percentage. The preview
// zoom (preview/PdfZoom) and the drawing dock's zoom (drawing/Toolbar) both compose it, so every
// surface zooms with the same controls. The run carries `data-bar-drop="4"`: inside a ViewBar it leaves
// the bar only when the bar cannot hold it (reachable from the `[≡]` menu), while a pinch or
// ctrl/cmd+wheel still zooms. Outside a ViewBar the attribute does nothing; `data-bar-menu-label="zoom"` names the run's row in the
// overflow panel. The glyphs rest in --text-muted and the percentage shares the readouts' x-height line.
import type { Component } from 'solid-js'
import type { ButtonSize } from './buttonClass'
import IconButton from './IconButton'
import Label from './Label'
import styles from './ZoomSteps.module.css'

export type ZoomStepsProps = {
    /** Current zoom; 1 = 100%. */
    zoom: () => number
    onZoomOut: () => void
    onZoomIn: () => void
    zoomOutDisabled?: boolean
    zoomInDisabled?: boolean
    /** Forwarded to both step buttons; a bare IconBar publishes no size context. */
    size?: ButtonSize
    /** The surrounding bar gives every icon unpainted bracket room (preview/PreviewBar): the two
     *  step buttons reserve it too (IconButton `bracketRoom`), and the run's gap steps up one so
     *  the percentage, which has no bracket room, sits the same distance from each glyph. Off keeps
     *  bare glyphs --bar-icon-gap apart. */
    wide?: boolean
    class?: string
    /** What the steps change, for their names: `Zoom out` / `Zoom in` and the `[≡]` row `zoom` by
     *  default; the book's text size passes `smaller text` / `larger text` / `text size`. */
    outLabel?: string
    inLabel?: string
    menuLabel?: string
    /** Test hook on the run; the preview zoom keeps the default. */
    'data-testid'?: string
}

const ZoomSteps: Component<ZoomStepsProps> = props => {
    return (
        <div
            class={`${styles.group} ${props.wide ? styles.wide : ''} ${props.class ?? ''}`}
            data-bar-drop="4"
            data-bar-menu-label={props.menuLabel ?? 'zoom'}
            data-testid={props['data-testid'] ?? 'pdf-zoom-steps'}
        >
            <IconButton
                icon="Minus"
                class={styles.step}
                size={props.size}
                bracketRoom={props.wide}
                label={props.outLabel ?? 'Zoom out'}
                title={props.outLabel ?? 'Zoom out'}
                disabled={props.zoomOutDisabled}
                onClick={() => props.onZoomOut()}
            />
            <Label tone="muted" class={styles.zoom}>
                {`${Math.round(props.zoom() * 100)}%`}
            </Label>
            <IconButton
                icon="Plus"
                class={styles.step}
                size={props.size}
                bracketRoom={props.wide}
                label={props.inLabel ?? 'Zoom in'}
                title={props.inLabel ?? 'Zoom in'}
                disabled={props.zoomInDisabled}
                onClick={() => props.onZoomIn()}
            />
        </div>
    )
}

export default ZoomSteps
