import {
    children,
    createEffect,
    createSignal,
    on,
    onCleanup,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import PlainButton from '../ui/PlainButton'
import styles from './FlipCard.module.css'

// The flip's `card-flip` animation is `none` under reduced motion (FlipCard.module.css), so no
// `animationend` would ever clear `data-flipping` — the card must not set it at all there.
const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export type FlipCardProps = {
    /** True once the answer is showing. The card only ever flips forward: a click while revealed
     *  does nothing (the deck advances by grading, which mounts a fresh card). */
    revealed: boolean
    /** Click, or Enter/Space while the card has focus (it is a real button). */
    onReveal: () => void
    /** Rendered markdown for the prompt — the front face, and the caption on the back. */
    promptHtml: string
    /** Rendered markdown for the answer body on the back face. */
    answerHtml: string
    /** The per-card actions (edit / reset / delete), pinned to the card's top-right. They sit
     *  OUTSIDE the reveal button — a control inside another control is not valid — so there is one
     *  set, always reachable, that does not turn with the card. */
    actions?: JSX.Element
    class?: string
}

/**
 * The flashcard: a `PlainButton` that reveals the answer, holding both faces for the CSS 3D flip.
 * Both faces stay mounted and `backface-visibility` hides the turned-away one VISUALLY only, so the
 * hidden face is `inert` — otherwise a keyboard user tabs into (and a screen reader reads) it.
 *
 * Its per-card state (`flipping`) lives here, so the keyed mount FlashcardsView gives it takes the
 * flag with it: a card graded mid-flip never leaves the next one stuck mid-animation.
 */
const FlipCard: Component<FlipCardProps> = props => {
    // True for exactly the flip animation on THIS card (either direction), exposed as
    // `data-flipping` on `.flip-inner`: it runs the `card-flip` keyframes and turns the faces'
    // `overflow` off for that window. Driven by an effect on `revealed` (deferred: a fresh card is
    // not a flip) rather than by each reveal call site.
    const [flipping, setFlipping] = createSignal(false)
    createEffect(
        on(
            () => props.revealed,
            () => {
                if (!prefersReducedMotion()) setFlipping(true)
            },
            { defer: true },
        ),
    )
    onCleanup(() => setFlipping(false))
    const settle = (e: AnimationEvent) => {
        if (e.target === e.currentTarget) setFlipping(false)
    }
    const actions = children(() => props.actions)

    return (
        <div class={`${styles.host} ${styles['card-appear']} ${props.class ?? ''}`}>
            <PlainButton
                class={`${styles['flip-card']} ${props.revealed ? styles.flipped : ''}`}
                aria-pressed={props.revealed}
                onClick={() => {
                    if (!props.revealed) props.onReveal()
                }}
            >
                <div
                    class={styles['flip-inner']}
                    data-flipping={flipping() || undefined}
                    onAnimationEnd={settle}
                    onAnimationCancel={settle}
                >
                    <div
                        class={styles['flip-face']}
                        data-face="front"
                        inert={props.revealed || undefined}
                    >
                        <div
                            class={styles['card-md']}
                            innerHTML={props.promptHtml}
                        />
                    </div>
                    <div
                        class={styles['flip-face']}
                        data-face="back"
                        inert={!props.revealed || undefined}
                    >
                        <div
                            class={styles['qcaption']}
                            innerHTML={props.promptHtml}
                        />
                        <div class={styles['fcdiv']} />
                        <div
                            class={`${styles['card-md']} ${styles['abody']}`}
                            innerHTML={props.answerHtml}
                        />
                    </div>
                </div>
            </PlainButton>
            <Show when={actions()}>
                <div class={styles['card-actions']}>{actions()}</div>
            </Show>
        </div>
    )
}

export default FlipCard
