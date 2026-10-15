// app/src/ui/ZoomSteps.tsx
// The one zoom-step shape `− 100% +`: two bare icon buttons around a muted percentage. The preview
// zoom (preview/PdfZoom) and the drawing dock's zoom (drawing/Toolbar) both compose it, so every
// surface zooms with the same controls. The run carries `data-bar-drop="4"`: inside a ViewBar the
// collapse ladder hides it on a narrow pane while a pinch or ctrl/cmd+wheel still zooms. Outside a
// ViewBar the attribute does nothing.
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
    /** The surrounding bar gives every icon unpainted bracket room (preview/PreviewBar): the
     *  controls then sit one step further apart. Off keeps --bar-icon-gap. */
    wide?: boolean
    class?: string
    /** Test hook on the run; the preview zoom keeps the default. */
    'data-testid'?: string
}

const ZoomSteps: Component<ZoomStepsProps> = props => {
    return (
        <div
            class={`${styles.group} ${props.wide ? styles.wide : ''} ${props.class ?? ''}`}
            data-bar-drop="4"
            data-testid={props['data-testid'] ?? 'pdf-zoom-steps'}
        >
            <IconButton
                icon="Minus"
                size={props.size}
                label="Zoom out"
                title="Zoom out"
                disabled={props.zoomOutDisabled}
                onClick={() => props.onZoomOut()}
            />
            <Label tone="muted" class={styles.zoom}>
                {`${Math.round(props.zoom() * 100)}%`}
            </Label>
            <IconButton
                icon="Plus"
                size={props.size}
                label="Zoom in"
                title="Zoom in"
                disabled={props.zoomInDisabled}
                onClick={() => props.onZoomIn()}
            />
        </div>
    )
}

export default ZoomSteps
