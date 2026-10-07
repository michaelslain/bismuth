// app/src/preview/ImagePane.tsx — ImagePane.tsx is the ONLY importer of ImagePane.module.css.
// An image preview's picture: either the plain CSS-centred `<img>`, or — once the scratch strip is
// on or the picture is zoomed — the same `<img>` laid out explicitly in host px beside its strip.
// The `<img>` is written ONCE (`picture`) and mounted by whichever branch is live.
import { Show, type Component, type JSX } from 'solid-js'
import ScratchPaper from './ScratchPaper'
import type { PageInkPage } from './PageInk'
import styles from './ImagePane.module.css'

export type ImagePaneProps = {
    src: string
    name: string
    /** The picture is laid out explicitly (scratch strip on, or zoomed) instead of CSS-centred. */
    scratch: boolean
    /** The measured page (rendered rect + strip width) once `measureImage` has run. */
    page?: PageInkPage
    /** Stage size (inline width/height) while laid out explicitly — the body scrolls to pan. */
    stageStyle?: JSX.CSSProperties
    /** True once there is a measured page for the ink overlay to sit over. */
    hasPages: boolean
    /** The mounted `<img>` (the plain and the explicit path each mount their own). */
    imgRef: (img: HTMLImageElement) => void
    onLoad: (img: HTMLImageElement) => void
    onError: () => void
    /** The ScratchTextLayer + PageInk, painted over the same stage as the picture. */
    overlay?: JSX.Element
}

const ImagePane: Component<ImagePaneProps> = props => {
    const rendered = () => props.page?.rendered
    // SCRATCH on: image + strip are laid out together in host px by measureImage/
    // imageScratchLayout.ts. With SCRATCH off the `<img>` is plain CSS auto-centring /
    // `object-fit: contain`, no wrapper, no inline sizing — the path `ImageInkLandsAtRealMeasuredRect`
    // measures.
    const picture = (scratch: boolean) => (
        <img
            ref={props.imgRef}
            data-testid="preview-image"
            class={styles['preview-image']}
            classList={{ [styles['preview-image--scratch']]: scratch }}
            src={props.src}
            alt={props.name}
            onLoad={e => props.onLoad(e.currentTarget)}
            onError={() => props.onError()}
            style={
                !scratch
                    ? undefined
                    : rendered()
                      ? {
                            left: `${rendered()!.left}px`,
                            top: `${rendered()!.top}px`,
                            width: `${rendered()!.w}px`,
                            height: `${rendered()!.h}px`,
                        }
                      : // Before the first measurement this `<img>` has no inline size (absolute, from
                        // `.preview-image--scratch`) and would paint at its natural size, pinned to
                        // the host's (0,0) corner, for one frame — hidden until `page` exists.
                        { visibility: 'hidden' }
            }
        />
    )
    return (
        <>
            <Show when={props.scratch} fallback={picture(false)}>
                <div class={styles['preview-image-host']} style={props.stageStyle}>
                    {picture(true)}
                    <Show when={(props.page?.marginW ?? 0) > 0}>
                        <ScratchPaper
                            index={0}
                            class={styles['preview-image-margin']}
                            style={{
                                position: 'absolute',
                                left: `${rendered()!.left + rendered()!.w}px`,
                                top: `${rendered()!.top}px`,
                                width: `${props.page!.marginW}px`,
                                height: `${rendered()!.h}px`,
                            }}
                        />
                    </Show>
                </div>
            </Show>
            {/* The overlays span the STAGE, not just the body's visible box, so on a zoomed-and-panned
                image PageInk's sticky draw dock still pins to the bottom of the scrollport. Order
                inside: ScratchTextLayer BEFORE PageInk, so draw-mode ink paints over the strip's
                note blocks. */}
            <Show when={props.hasPages}>
                <div class={styles['preview-image-overlay']} style={props.stageStyle}>
                    {props.overlay}
                </div>
            </Show>
        </>
    )
}

export default ImagePane
