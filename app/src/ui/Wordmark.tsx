import type { Component } from 'solid-js'
import Text from './Text'
import Caret from './Caret'
import styles from './Wordmark.module.css'

export type WordmarkProps = {
    /** 'body' = --fs-body (top strip), 'hero' = --fs-hero. Default 'body'. */
    size?: 'body' | 'hero'
    /** Trailing blinking <Caret /> (ui/Caret). ON by default: the mark is the word AND its cursor,
     *  wherever it appears (top strip, intro window, intro slides). Pass false for a bare word. */
    caret?: boolean
    class?: string
}

/**
 * The word `bismuth` in the `.asc-wordmark` gradient sheen: the app's one name mark, in the
 * corner of the top strip. `.asc-wordmark` stays a bare global string
 * (global.css, with its `@keyframes asc-sheen` and reduced-motion rule) — this component is the
 * one place that writes it for the word `bismuth`, so call sites compose <Wordmark> instead of
 * the class. `DaemonFace` uses the class for its own face.
 *
 * The caret sits BESIDE the word inside a flex wrapper, never inside the `.asc-wordmark` span:
 * that span paints through `background-clip: text` with transparent text, and a child glyph
 * inside it would take on the gradient instead of the caret's own accent colour.
 */
const Wordmark: Component<WordmarkProps> = props => {
    return (
        <Text
            as="span"
            inherit
            class={[
                styles.wordmark,
                props.size === 'hero'
                    ? styles['wordmark--hero']
                    : styles['wordmark--body'],
                props.class,
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <Text as="span" inherit class="asc-wordmark">
                bismuth
            </Text>
            {props.caret !== false && <Caret class={styles.caret} />}
        </Text>
    )
}

export default Wordmark
