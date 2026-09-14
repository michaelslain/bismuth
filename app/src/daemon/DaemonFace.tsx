// app/src/daemon/DaemonFace.tsx
// The daemon's living `.:[00]:.` — eight huge literal glyphs, each in a fixed one-`ch` cell, so a
// character swap never reflows. This component only owns the clocks: the eye tick, a separate slow
// breath for the side dots, a randomised blink, hover and a click-wink. What to draw at any moment
// is daemonFaceModel.ts's job.
//
// Motion discipline: every timer stops while the document is hidden and on cleanup; under
// `prefers-reduced-motion: reduce` the tick never advances (the frame stays at tick 0) but blinks
// still happen — a blink is a single state change, not movement.
import {
    createEffect,
    createMemo,
    createSignal,
    Index,
    onCleanup,
    onMount,
    Show,
    type Component,
    type JSX,
} from 'solid-js'
import Text from '../ui/Text'
import {
    BLINK_MS,
    BREATH_MS,
    canBlink,
    composeFace,
    DOUBLE_BLINK_GAP_MS,
    moodLabel,
    nextBlinkDelay,
    tickMs,
    WINK_MS,
    type DaemonMood,
} from './daemonFaceModel'
import styles from './DaemonFace.module.css'

export type DaemonFaceProps = {
    mood: DaemonMood
    /** A status line centred under the face, e.g. `watching // last: dream 2h ago`. */
    caption?: JSX.Element
    class?: string
}

type Timer = ReturnType<typeof setTimeout>

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function isHidden(): boolean {
    return (
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
    )
}

function reducedMotionQuery(): MediaQueryList | undefined {
    return typeof window !== 'undefined'
        ? window.matchMedia?.(REDUCED_MOTION)
        : undefined
}

function cellClass(i: number): string {
    if (i === 3 || i === 4) return `${styles.cell} ${styles.eye}`
    if (i === 2 || i === 5) return `${styles.cell} ${styles.bracket}`
    return styles.cell
}

const DaemonFace: Component<DaemonFaceProps> = props => {
    const [tick, setTick] = createSignal(0)
    const [breath, setBreath] = createSignal(0)
    const [blinking, setBlinking] = createSignal(false)
    const [hovered, setHovered] = createSignal(false)
    const [winking, setWinking] = createSignal(false)
    const [hidden, setHidden] = createSignal(isHidden())
    const [reduced, setReduced] = createSignal(
        reducedMotionQuery()?.matches ?? false,
    )

    onMount(() => {
        const onVisibility = () => setHidden(isHidden())
        document.addEventListener('visibilitychange', onVisibility)
        const mq = reducedMotionQuery()
        const onMotion = (e: MediaQueryListEvent) => setReduced(e.matches)
        mq?.addEventListener('change', onMotion)
        onCleanup(() => {
            document.removeEventListener('visibilitychange', onVisibility)
            mq?.removeEventListener('change', onMotion)
        })
    })

    // The eye clock. Restarts from tick 0 whenever the mood changes, the page comes back into
    // view, or reduced motion flips.
    createEffect(() => {
        const mood = props.mood
        setTick(0)
        if (hidden() || reduced()) return
        const id = setInterval(() => setTick(t => t + 1), tickMs(mood))
        onCleanup(() => clearInterval(id))
    })

    // The breath clock — the side dots only, always BREATH_MS whatever the mood, so a fast eye
    // tick never makes the face twitch. Deliberately NOT reset by a mood change: breathing carries
    // on through one. Stops while hidden and under reduced motion (it is movement, not a state).
    createEffect(() => {
        if (hidden() || reduced()) {
            setBreath(0)
            return
        }
        const id = setInterval(() => setBreath(b => b + 1), BREATH_MS)
        onCleanup(() => clearInterval(id))
    })

    // The blink clock: wait a randomised delay, shut the eyes for BLINK_MS (twice, sometimes),
    // then schedule the next one. Runs under reduced motion too; asleep and hurt never blink.
    createEffect(() => {
        const mood = props.mood
        if (hidden() || !canBlink(mood)) return
        let timer: Timer | undefined
        const schedule = () => {
            const next = nextBlinkDelay(mood, Math.random)
            if (!Number.isFinite(next.delayMs)) return
            timer = setTimeout(() => blink(next.double ? 1 : 0), next.delayMs)
        }
        const blink = (repeats: number) => {
            setBlinking(true)
            timer = setTimeout(() => {
                setBlinking(false)
                if (repeats > 0)
                    timer = setTimeout(
                        () => blink(repeats - 1),
                        DOUBLE_BLINK_GAP_MS,
                    )
                else schedule()
            }, BLINK_MS)
        }
        schedule()
        onCleanup(() => {
            clearTimeout(timer)
            setBlinking(false)
        })
    })

    let winkTimer: Timer | undefined
    const wink = () => {
        if (props.mood === 'asleep') return
        clearTimeout(winkTimer)
        setWinking(true)
        winkTimer = setTimeout(() => setWinking(false), WINK_MS)
    }
    onCleanup(() => clearTimeout(winkTimer))

    const cells = createMemo(() =>
        composeFace(
            props.mood,
            tick(),
            {
                blinking: blinking(),
                hovered: hovered(),
                winking: winking(),
            },
            breath(),
        ),
    )

    return (
        <div class={[styles.root, props.class].filter(Boolean).join(' ')}>
            <div
                class={styles.face}
                role="img"
                aria-label={'daemon — ' + moodLabel(props.mood)}
                data-mood={props.mood}
                data-testid="daemon-face"
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                onClick={wink}
            >
                <Index each={cells()}>
                    {(c, i) => <span class={cellClass(i)}>{c()}</span>}
                </Index>
            </div>
            <Show when={props.caption}>
                <Text size="ui" tone="muted" class={styles.caption}>
                    {props.caption}
                </Text>
            </Show>
        </div>
    )
}

export default DaemonFace
