// app/src/preview/ScratchPaper.tsx
// The note-styled surface used for the scratch strip beside a PDF page or image — the note
// editor's own ground (`--editor`) with a soft hairline (`--rule-soft`) where it meets the page,
// so the strip reads as a place to write rather than more of the (white) page (scratch-notes
// decision 3). Positioning, sizing and any page-specific chrome (drop shadow, clip-path) are the
// CALLER's: PdfPages.tsx composes this with its own `.pdf-margin` class for a PDF page's strip,
// and PreviewView's image body does the same for an image's. This component paints the surface
// and nothing else — the click-to-place blocks living on top of it are ScratchTextLayer's job.
import type { JSX } from 'solid-js'
import styles from './ScratchPaper.module.css'

export type ScratchPaperProps = {
    /** Caller positions/sizes it (absolute left/top/width/height). */
    style?: JSX.CSSProperties
    class?: string
    /** Page index, written as `data-pdf-margin` (existing runtime/test hook — keep the name). */
    index: number
}

function ScratchPaper(props: ScratchPaperProps) {
    return (
        <div
            class={`${styles['scratch-paper']} ${props.class ?? ''}`}
            data-pdf-margin={props.index}
            style={props.style}
        />
    )
}

export default ScratchPaper
