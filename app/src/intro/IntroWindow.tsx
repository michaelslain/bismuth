// The intro's framed window: a wordmark strip (echoing the app's TopStrip), a body holding a
// fixed-height art box and a fixed-height text slot, and a footer slot. It owns NO content and does
// not position itself — its parent centres it. Slots carry `data-intro-slot` runtime hooks.
import type { Component, JSX } from 'solid-js'
import Band from '../ui/Band'
import TextButton from '../ui/TextButton'
import Wordmark from '../ui/Wordmark'
import styles from './IntroWindow.module.css'

export type IntroWindowProps = {
    /** The slide's art, centred in the fixed-height art box. */
    art?: JSX.Element
    /** IntroCopy. Fixed-height slot: the headline sits at one y on every slide. */
    text: JSX.Element
    /** Drawn behind the whole body (art + copy), not just the art box: a live graph that needs the
     *  room a 3D cloud fits to (the palette slide). */
    backdrop?: JSX.Element
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
        >
            <Band class={styles['strip']}>
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
                <div class={styles['backdrop']} data-intro-slot="backdrop">
                    {props.backdrop}
                </div>
                <div class={styles['art']} data-intro-slot="art">
                    {props.art}
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
