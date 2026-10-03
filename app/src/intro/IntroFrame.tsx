// The one geometry every intro slide is laid out on. A fixed grid — outer rows 1fr, the hero box and
// the text slot at fixed heights, the nav last — so the hero box, the headline and the nav sit at the
// same y on every slide whatever is inside them. The frame owns NO content: VaultIntro composes a
// hero (GlyphArt, nothing on the graph slide, or a control on the setup slides), the copy and the nav
// into the three slots. Task code finds the slots by `data-intro-slot`, never by class.
import type { Component, JSX } from 'solid-js'
import styles from './IntroFrame.module.css'

export type IntroFrameVariant = 'hero' | 'setup'

export type IntroFrameProps = {
    variant: IntroFrameVariant
    /** Hero box content: GlyphArt (hero), nothing (graph slide), or a control (setup). */
    hero?: JSX.Element
    /** Text slot: IntroCopy, plus the CTA on the begin slide. */
    text: JSX.Element
    /** Nav slot: IntroNav. */
    nav: JSX.Element
    className?: string
}

const IntroFrame: Component<IntroFrameProps> = props => {
    return (
        <div
            class={[styles['intro-frame'], props.className]
                .filter(Boolean)
                .join(' ')}
            data-intro-frame={props.variant}
        >
            <div class={styles['hero']} data-intro-slot="hero">
                {props.hero}
            </div>
            <div class={styles['text']} data-intro-slot="text">
                {props.text}
            </div>
            <div class={styles['nav']} data-intro-slot="nav">
                {props.nav}
            </div>
        </div>
    )
}

export default IntroFrame
