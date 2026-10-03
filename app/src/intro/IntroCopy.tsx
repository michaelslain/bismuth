// The first-run intro's copy block — one slide's headline over its paragraph, set in the prose
// face (a headline and a two-line explanation are what a person READS, not chrome or data).
//
// VaultIntro keys it on the slide, so it remounts per slide and the text types in again (headline
// first, then the paragraph — see introTyping.ts); the persistent graph behind it never remounts.
// The FULL text is in the DOM from the first frame — the not-yet-typed remainder is only
// `visibility: hidden` — so layout never reflows and the accessibility tree never changes.
import { createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import { typedCounts, typingDuration } from './introTyping'
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
    const counts = createMemo(() =>
        typedCounts(elapsed(), props.title.length, props.body.length),
    )

    onMount(() => {
        if (!animate()) return
        const duration = typingDuration(props.title.length, props.body.length)
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
                <Text as="span" inherit class={styles.untyped}>
                    {props.title.slice(counts().title)}
                </Text>
            </Heading>
            <Text size="title" register="prose" class={styles.body}>
                <Text as="span" inherit>
                    {props.body.slice(0, counts().body)}
                </Text>
                <Text as="span" inherit class={styles.untyped}>
                    {props.body.slice(counts().body)}
                </Text>
            </Text>
        </div>
    )
}

export default IntroCopy
