// app/src/preview/PdfZoom.tsx
// The preview zoom group `− 100% + fit`: shared by the preview tab's bar (preview/PreviewBar — a
// PDF or an image) and the in-note PDF embed's header (editor/PdfEmbed), so every surface zooms the
// same way with the same controls (the steps are ui/ZoomSteps). Only the steps carry `data-bar-drop="4"` — inside a ViewBar the
// collapse ladder hides them on a narrow pane while a pinch or ctrl/cmd+wheel still zooms and `fit` stays as the one-click way back. Outside
// a ViewBar the attribute does nothing.
import TextButton from '../ui/TextButton'
import ZoomSteps from '../ui/ZoomSteps'
import styles from './PdfZoom.module.css'

/** One zoom-step factor for the − / + buttons. */
export const ZOOM_STEP = 1.2

export type PdfZoomProps = {
    /** Current zoom; 1 = fit width. */
    zoom: () => number
    onZoomBy: (factor: number) => void
    onFit: () => void
    /** The surrounding bar gives every icon unpainted bracket room (preview/PreviewBar): the
     *  controls here then sit one step further apart, so `−` `100%` `+` `fit` keep the bar's
     *  glyph-to-glyph distance. Off (the in-note embed, export) keeps --bar-icon-gap. */
    wide?: boolean
    class?: string
}

function PdfZoom(props: PdfZoomProps) {
    return (
        <div
            class={`${styles.group} ${props.wide ? styles.wide : ''} ${props.class ?? ''}`}
            data-testid="pdf-zoom-cluster"
        >
            <ZoomSteps
                zoom={props.zoom}
                wide={props.wide}
                onZoomOut={() => props.onZoomBy(1 / ZOOM_STEP)}
                onZoomIn={() => props.onZoomBy(ZOOM_STEP)}
            />
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
