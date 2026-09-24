// app/src/daemon/DaemonFace.tsx
// The daemon's living `.:[00]:.` — eight huge literal glyphs in the wordmark's rainbow sheen.
// Monospace, so a character swap never reflows. This component only owns the clocks: the eye tick,
// a randomised blink, hover and a click-wink (the side dots never move). What to draw at any
// moment is daemonFaceModel.ts's job.
//
// `props.mood` is the RAW derived mood, which the caller is free to flip on every poll or
// keystroke — this component runs the settle (daemonFaceModel.ts's `settleMood`) on its own clock
// so what actually paints (`renderedMood`) only ever changes after the new mood has held
// MOOD_SETTLE_MS, and does so through one blink frame rather than a hard cut.
//
// Motion discipline: the eye and blink clocks stop while the document is hidden and on cleanup;
// the one-shot settle/transition timers do not. Under `prefers-reduced-motion: reduce` the tick
// never advances (the frame stays at tick 0) but blinks still happen — a blink is a single state
// change, not movement.
import {
    createEffect,
    createMemo,
    createSignal,
    Index,
    onCleanup,
    onMount,
    Show,
    untrack,
    type Component,
    type JSX,
} from 'solid-js'
import Text from '../ui/Text'
import {
    BLINK_MS,
    canBlink,
    composeFace,
    DOUBLE_BLINK_GAP_MS,
    initialSettle,
    moodLabel,
    MOOD_SETTLE_MS,
    nextBlinkDelay,
    settleMood,
    tickMs,
    WINK_MS,
    type DaemonMood,
    type SettleState,
} from './daemonFaceModel'
import styles from './DaemonFace.module.css'

export type DaemonFaceProps = {
    mood: DaemonMood
    /** A status line centred under the face, e.g. `watching // last: dream 2h ago`. */
    caption?: JSX.Element
    /** Smaller glyph, same caption — the daemon page sets this once a conversation has messages. */
    compact?: boolean
    /** True while the host has no snapshot yet — the very first `mood` is provisional (derived
     *  from a NO_SNAPSHOT default), so it must paint immediately with no settle delay once
     *  `loading` drops rather than being treated as just another mood change. */
    loading?: boolean
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

/** Letter-spacing lands AFTER a glyph, so each cell's class sets the gap to its right neighbour:
 *  `.` `:` → arm gaps, `[` → bracket-to-eye, first eye → between the eyes, second eye →
 *  eye-to-bracket, `]` `:` → arm gaps. Symmetric by construction. Eyes also get `.eye` (hurt ink). */
const GAP = ['arm', 'arm', 'edge', 'eyes', 'edge', 'arm', 'arm', 'arm'] as const

function cellClass(i: number): string {
    const eye = i === 3 || i === 4 ? ` ${styles.eye}` : ''
    return `${styles.cell} ${styles[`gap-${GAP[i]}`]}${eye}`
}

const DaemonFace: Component<DaemonFaceProps> = props => {
    const [tick, setTick] = createSignal(0)
    const [blinking, setBlinking] = createSignal(false)
    const [hovered, setHovered] = createSignal(false)
    const [winking, setWinking] = createSignal(false)
    const [hidden, setHidden] = createSignal(isHidden())
    const [reduced, setReduced] = createSignal(
        reducedMotionQuery()?.matches ?? false,
    )

    // `props.mood` is the RAW derived mood — it can flip several times a second (a poll, a
    // keystroke). `settle` holds it to `MOOD_SETTLE_MS` before it counts as a real mood change
    // (daemonFaceModel.ts's hysteresis); `renderedMood` is what is actually painted, one blink
    // frame behind a settled change (see the transition effect below).
    const [settle, setSettle] = createSignal<SettleState>(
        initialSettle(props.mood, Date.now()),
    )
    const [renderedMood, setRenderedMood] = createSignal<DaemonMood>(
        settle().shown,
    )
    const [transitionBlink, setTransitionBlink] = createSignal(false)

    // Feed every raw mood change into the settle machine — except while `loading`: the mood
    // derived from a not-yet-loaded snapshot is provisional, so it must not itself settle or
    // paint. The moment `loading` drops, the first real mood shows immediately (no settle delay,
    // no blink) rather than waiting out MOOD_SETTLE_MS like an ordinary change.
    createEffect((wasLoading: boolean) => {
        const loading = props.loading ?? false
        const next = props.mood
        if (loading) return true
        if (wasLoading) {
            setSettle(initialSettle(next, Date.now()))
            setRenderedMood(next)
            return false
        }
        setSettle(s => settleMood(s, next, Date.now()))
        return false
    }, props.loading ?? false)

    // A settle can only flip once its `pending` has held MOOD_SETTLE_MS — that needs a clock of
    // its own, not just a reaction to prop changes, in case the mood stops changing while waiting.
    createEffect(() => {
        const s = settle()
        if (s.pending === null) return
        const remaining = s.since + MOOD_SETTLE_MS - Date.now()
        const id = setTimeout(
            () =>
                setSettle(cur =>
                    settleMood(
                        cur,
                        props.mood,
                        Math.max(Date.now(), cur.since + MOOD_SETTLE_MS),
                    ),
                ),
            Math.max(0, remaining),
        )
        onCleanup(() => clearTimeout(id))
    })

    // A settled mood change paints ONE blink frame before the new mood's eyes — skipped when
    // either side is `asleep`, which has no open eyes to close.
    createEffect(() => {
        const shown = settle().shown
        const prev = untrack(renderedMood)
        if (shown === prev) return
        if (!canBlink(prev) || !canBlink(shown)) {
            setRenderedMood(shown)
            return
        }
        setTransitionBlink(true)
        const id = setTimeout(() => {
            setTransitionBlink(false)
            setRenderedMood(shown)
        }, BLINK_MS)
        onCleanup(() => clearTimeout(id))
    })

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

    // The eye clock. Restarts from tick 0 whenever the rendered mood changes, the page comes back
    // into view, or reduced motion flips.
    createEffect(() => {
        const mood = renderedMood()
        setTick(0)
        if (hidden() || reduced()) return
        const id = setInterval(() => setTick(t => t + 1), tickMs(mood))
        onCleanup(() => clearInterval(id))
    })

    // The blink clock: wait a randomised delay, shut the eyes for BLINK_MS (twice, sometimes),
    // then schedule the next one. Runs under reduced motion too; asleep and hurt never blink.
    createEffect(() => {
        const mood = renderedMood()
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
        if (renderedMood() === 'asleep') return
        clearTimeout(winkTimer)
        setWinking(true)
        winkTimer = setTimeout(() => setWinking(false), WINK_MS)
    }
    onCleanup(() => clearTimeout(winkTimer))

    const cells = createMemo(() =>
        composeFace(renderedMood(), tick(), {
            blinking: blinking() || transitionBlink(),
            hovered: hovered(),
            winking: winking(),
        }),
    )

    return (
        <div
            class={[
                styles.root,
                props.compact ? styles.compact : '',
                props.class,
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div
                // `asc-wordmark` is a bare global on purpose — the app's one gradient flourish (App.css),
                // shared with the top strip and intro hero; see DaemonFace.module.css `.face`.
                class={`${styles.face} asc-wordmark`}
                role="img"
                aria-label={'daemon — ' + moodLabel(renderedMood())}
                data-mood={renderedMood()}
                data-testid="daemon-face"
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                onClick={wink}
            >
                <Index each={cells()}>
                    {(c, i) => (
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={cellClass(i)}
                        >
                            {c()}
                        </Text>
                    )}
                </Index>
            </div>
            <Show when={props.caption}>
                {/* Text (ui/Text.tsx) now forwards every other HTML attribute, incl. data-*, so
                    `data-testid` lands directly on it — no bare wrapper span needed. */}
                <Text
                    data-testid="daemon-face-caption"
                    size="ui"
                    tone="muted"
                    class={styles.caption}
                >
                    {props.caption}
                </Text>
            </Show>
        </div>
    )
}

export default DaemonFace
