// app/src/preview/PdfZoom.tsx
// The PDF zoom group `− 100% + fit`: shared by the preview tab's bar (preview/PreviewBar) and the
// in-note PDF embed's header (editor/PdfEmbed), so both zoom the same way with the same controls.
// Only the steps carry `data-bar-drop="4"` — inside a ViewBar the collapse ladder hides them on a
// narrow pane while ctrl/cmd+wheel still zooms and `fit` stays as the one-click way back. Outside
// a ViewBar the attribute does nothing.
import IconButton from '../ui/IconButton'
import TextButton from '../ui/TextButton'
import Label from '../ui/Label'
import styles from './PdfZoom.module.css'

/** One zoom-step factor for the − / + buttons. */
export const ZOOM_STEP = 1.2

export type PdfZoomProps = {
    /** Current zoom; 1 = fit width. */
    zoom: () => number
    onZoomBy: (factor: number) => void
    onFit: () => void
    class?: string
}

function PdfZoom(props: PdfZoomProps) {
    return (
        <div
            class={`${styles.group} ${props.class ?? ''}`}
            data-testid="pdf-zoom-cluster"
        >
            <div
                class={styles.group}
                data-bar-drop="4"
                data-testid="pdf-zoom-steps"
            >
                <IconButton
                    icon="Minus"
                    label="Zoom out"
                    title="Zoom out"
                    onClick={() => props.onZoomBy(1 / ZOOM_STEP)}
                />
                <Label tone="muted" class={styles.zoom}>
                    {`${Math.round(props.zoom() * 100)}%`}
                </Label>
                <IconButton
                    icon="Plus"
                    label="Zoom in"
                    title="Zoom in"
                    onClick={() => props.onZoomBy(ZOOM_STEP)}
                />
            </div>
            <TextButton
                title="Fit width"
                aria-label="Fit width"
                onClick={() => props.onFit()}
            >
                fit
            </TextButton>
        </div>
    )
}

export default PdfZoom
