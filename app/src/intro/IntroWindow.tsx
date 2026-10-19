// The intro's borderless frame: a wordmark strip (echoing the app's TopStrip), a body that centres the
// art over the copy as one group, and a footer slot. It fills its parent and owns
// NO content. Slots carry `data-intro-slot` runtime hooks.
import type { Component, JSX } from 'solid-js'
import Band from '../ui/Band'
import TextButton from '../ui/TextButton'
import Wordmark from '../ui/Wordmark'
import styles from './IntroWindow.module.css'

export type IntroWindowProps = {
    /** The slide's art: centred across the art box and standing on its floor, over the copy. */
    art?: JSX.Element
    /** IntroCopy, under the art. */
    text: JSX.Element
    /** Drawn behind the art, filling the art box and free to spill past it: a live graph that needs
     *  the room a 3D cloud fits to (the palette slide). Pair it with `artFill`. */
    backdrop?: JSX.Element
    /** Hold the art box at its full height (the body's art budget) instead of its content's. */
    artFill?: boolean
    /** Size the art box to its content even past the art budget, shrinking only to leave the copy its
     *  room: for art that must show whole (the privacy picker). The art caps itself at the box's
     *  height (`max-height: 100%`) and scrolls only when the window is too short for it. */
    artFit?: boolean
    /** IntroFooter. */
    footer: JSX.Element
    /** The strip's [skip] ("Skip intro"). */
    onClose: () => void
    className?: string
}

const IntroWindow: Component<IntroWindowProps> = props => {
    return (
        <section
            class={[styles['intro-window'], props.className]
                .filter(Boolean)
                .join(' ')}
            aria-label="Welcome to Bismuth"
            data-intro-window
        >
            <Band rule="none" class={styles['strip']}>
                <Wordmark size="body" />
                <div class={styles['spacer']} />
                <TextButton
                    onClick={() => props.onClose()}
                    aria-label="Skip intro"
                >
                    skip
                </TextButton>
            </Band>
            <div class={styles['body']}>
                <div
                    class={styles['art']}
                    classList={{
                        [styles['art--fill']]: !!props.artFill,
                        [styles['art--fit']]: !!props.artFit,
                    }}
                    data-intro-slot="art"
                >
                    <div class={styles['backdrop']} data-intro-slot="backdrop">
                        {props.backdrop}
                    </div>
                    <div class={styles['art-content']}>{props.art}</div>
                </div>
                <div class={styles['text']} data-intro-slot="text">
                    {props.text}
                </div>
            </div>
            <div class={styles['footer']} data-intro-slot="footer">
                {props.footer}
            </div>
        </section>
    )
}

export default IntroWindow
