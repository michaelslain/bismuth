// The first-run intro's copy block — one slide's headline over its paragraph, set in the prose
// face (a headline and a two-line explanation are what a person READS, not chrome or data).
//
// VaultIntro keys it on the slide, so it remounts per slide and the text types in again (headline
// first, then the paragraph, at an irregular per-letter rhythm — see introTyping.ts) behind a
// cursor; the persistent graph behind it never remounts.
// The FULL text is in the DOM from the first frame — the not-yet-typed remainder is only
// `opacity: 0`, and the cursor is a zero-width box whose `_` overhangs the next letter's cell — so
// layout never reflows and the accessibility tree never changes (the cursor is aria-hidden).
import {
    Show,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import Caret from '../ui/Caret'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import { typedCounts, typingPlan } from './introTyping'
import styles from './IntroCopy.module.css'

export type IntroCopyProps = {
    title: string
    body: string
    /** Graph is painted directly behind the copy: add the --bg text halo + radial scrim. */
    backdrop?: boolean
    /** Type the text in on mount (default true). False, or `prefers-reduced-motion`, shows both
     *  texts whole from the first frame. */
    type?: boolean
    class?: string
}

const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

const IntroCopy: Component<IntroCopyProps> = props => {
    const animate = () => props.type !== false && !prefersReducedMotion()
    // Infinity = whole text; the loop below only runs (and starts from 0) when animating.
    const [elapsed, setElapsed] = createSignal(animate() ? 0 : Infinity)
    const plan = createMemo(() => typingPlan(props.title, props.body))
    const counts = createMemo(() => typedCounts(elapsed(), plan()))
    // The cursor rides the line being typed, then rests blinking at the end of the body. It only
    // exists when the text types in: a whole-text render has nothing to point at.
    const cursorIn = (): 'title' | 'body' | null => {
        if (!animate()) return null
        return counts().title < props.title.length ? 'title' : 'body'
    }
    const typing = () => elapsed() !== Infinity

    onMount(() => {
        if (!animate()) return
        const duration = plan().duration
        const start = performance.now()
        let raf = 0
        const tick = (now: number) => {
            const t = now - start
            if (t >= duration) {
                setElapsed(Infinity)
                return
            }
            setElapsed(t)
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        onCleanup(() => cancelAnimationFrame(raf))
    })

    // Solid while typing (a terminal cursor does not blink mid-keystroke), blinking once it rests.
    const cursor = () => (
        <Text
            as="span"
            inherit
            aria-hidden="true"
            data-cursor
            class={styles.cursor}
        >
            <Caret
                class={[styles.caret, typing() ? styles['caret--typing'] : '']
                    .filter(Boolean)
                    .join(' ')}
            />
        </Text>
    )

    return (
        <div
            class={[
                styles['intro-copy'],
                props.backdrop ? styles['intro-copy--backdrop'] : '',
                props.class,
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <Heading level={1} size="hero-xl" register="prose">
                <Text as="span" inherit>
                    {props.title.slice(0, counts().title)}
                </Text>
                <Show when={cursorIn() === 'title'}>{cursor()}</Show>
                <Text as="span" inherit class={styles.untyped} data-untyped>
                    {props.title.slice(counts().title)}
                </Text>
            </Heading>
            <Text size="title" register="prose" class={styles.body}>
                <Text as="span" inherit>
                    {props.body.slice(0, counts().body)}
                </Text>
                <Show when={cursorIn() === 'body'}>{cursor()}</Show>
                <Text as="span" inherit class={styles.untyped} data-untyped>
                    {props.body.slice(counts().body)}
                </Text>
            </Text>
        </div>
    )
}

export default IntroCopy
