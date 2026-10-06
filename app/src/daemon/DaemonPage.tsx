// app/src/daemon/DaemonPage.tsx
// The daemon page — the FULL overview, always (or ONE opened section filling the stage). Presentational only: DaemonPageHost fetches and
// derives, this lays it out. A ViewBar on top carries only identity and the status readout — no
// facet toggle any more, every section shows at once. Below it, a two-column stage: DaemonHub
// (the face, its identity, its own chat) on the left, the right column (`props.overview` — the
// host's <DaemonOverview/>: inbox, crons, services, log stacked top to bottom, the log filling
// the rest) on the right — handed in as a slot so this file never imports DaemonInbox/
// DaemonCrons/DaemonProcesses/DaemonLog/DaemonOverview directly.
//
// Opened (`opened` set): `openedView` (the host's DaemonTakeover) fills the stage and the
// ViewBar's locus reads `/ <key>`. Opening, an empty FRAME (a bare quiet Card, gold for the
// inbox) fades in over the clicked box (`[data-section="<key>"]`) and grows to the opened view's
// rect while the view fades in place; closing runs it backwards, the frame shrinking onto the box
// and fading to reveal it (takeoverMotion.ts, `--dur-grow` + `--ease`; instant under
// prefers-reduced-motion, and when the page mounts already opened). Only the empty frame moves:
// the view and the box do not look alike, and any overlap of the two moving read as shuddering,
// doubled text. The rest (hub + overview) stays MOUNTED throughout and is hidden
// (`display: none`) only once the open has finished, so the box is visible behind the motion and
// the chat composer's local draft survives the section opening and closing. The host keeps
// `openedView` rendering the LAST opened section after `opened` clears, so the close can fade it.
//
// Off (`enabled === false`): DaemonHub itself sleeps (no identity, no chat) and this file drops
// the overview column entirely — leaving one EmptyState under the face saying how to wake it.
import {
    createEffect,
    createSignal,
    Index,
    on,
    onCleanup,
    Show,
    type JSX,
} from 'solid-js'
import ViewBar, { Crumb } from '../ui/ViewBar'
import BarLabel from '../ui/BarLabel'
import Text from '../ui/Text'
import DaemonHub from './DaemonHub'
import type { DaemonMood } from './daemonFaceModel'
import type { DaemonSectionKey } from './DaemonOverview'
import Card from '../ui/Card'
import {
    frameFade,
    growKeyframes,
    parseDuration,
    viewFade,
} from './takeoverMotion'
import styles from './DaemonPage.module.css'

export type DaemonPageProps = {
    name: string
    /** The daemon's personality blurb — `identity.md`'s first body line. `''` renders nothing. */
    blurb: string
    enabled: boolean
    mood: DaemonMood
    /** True while the host has no snapshot yet — forwarded to DaemonHub/DaemonFace so the first
     *  real mood paints immediately instead of settling against the provisional one. */
    loading?: boolean
    /** The ONE trailing readout — the status string, or empty (see daemonPageModel.barReadouts). */
    readouts: string[]
    /** The right column — the host passes <DaemonOverview/>. */
    overview: JSX.Element
    /** The hub's own chat, rendered under the face/identity. Host passes <DaemonChat/>; stories
     *  a stub. Expected to fill the height it's given. */
    chat: JSX.Element
    /** true once the conversation has any items. See `chatFills`. */
    conversing: boolean
    /** The hub's chat region fills the column instead of sizing to its content — true while
     *  conversing, and also while a full-height pane (like chat history) has taken the region. */
    chatFills: boolean
    onEditIdentity: () => void
    /** The section opened full screen, or null/undefined for the normal two-column page. */
    opened?: DaemonSectionKey | null
    /** What fills the stage while `opened` is set — the host passes a DaemonTakeover. It must keep
     *  rendering the last opened section after `opened` clears: the close animation shows it. */
    openedView?: JSX.Element
    class?: string
}

const GROW_FALLBACK_MS = 140

const reducedMotion = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function DaemonPage(props: DaemonPageProps) {
    let body!: HTMLDivElement
    let overlay: HTMLDivElement | undefined
    let frameEl: HTMLDivElement | undefined
    let anims: Animation[] = []
    let raf = 0
    // `shown`: the opened view is in the DOM (it outlives `opened` while it fades out).
    // `covered`: the open has finished, so the rest can be hidden behind it.
    // `frame`: the empty box that carries the motion, styled like the box it grows from.
    const [shown, setShown] = createSignal<DaemonSectionKey | null>(
        props.opened ?? null,
    )
    const [covered, setCovered] = createSignal(!!props.opened)
    const [frame, setFrame] = createSignal<{ attention: boolean } | null>(null)

    const sourceBox = (key: DaemonSectionKey) =>
        body.querySelector<HTMLElement>(`[data-section="${key}"]`)

    const stop = () => {
        cancelAnimationFrame(raf)
        anims.forEach(a => a.cancel())
        anims = []
        setFrame(null)
    }
    onCleanup(stop)

    const play = (box: HTMLElement, shrink: boolean, done: () => void) => {
        setFrame({ attention: box.dataset.attention === 'true' })
        if (!overlay || !frameEl) {
            setFrame(null)
            return done()
        }
        const cs = getComputedStyle(overlay)
        const duration = parseDuration(
            cs.getPropertyValue('--dur-grow'),
            GROW_FALLBACK_MS,
        )
        const frames = growKeyframes(
            box.getBoundingClientRect(),
            overlay.getBoundingClientRect(),
            body.getBoundingClientRect(),
        )
        const linear = { duration, easing: 'linear', fill: 'both' } as const
        const move = frameEl.animate(shrink ? frames.reverse() : frames, {
            duration,
            easing: cs.getPropertyValue('--ease').trim() || 'ease-out',
            fill: 'both',
        })
        anims = [
            move,
            frameEl.animate(frameFade(shrink), linear),
            overlay.animate(viewFade(shrink), linear),
        ]
        move.onfinish = () => {
            // The view's fade ends at its resting opacity (1 open, removed when closed), so
            // dropping the held effects changes nothing on screen.
            anims.forEach(a => a.cancel())
            anims = []
            setFrame(null)
            done()
        }
    }

    createEffect(
        on(
            () => props.opened ?? null,
            (next, prev) => {
                stop()
                if (next) {
                    // Find the box BEFORE the view covers it; switching straight from one open
                    // section to another has no box on screen to grow from.
                    const box = prev ? null : sourceBox(next)
                    setShown(next)
                    if (!box || reducedMotion()) return setCovered(true)
                    setCovered(false)
                    raf = requestAnimationFrame(() =>
                        play(box, false, () => setCovered(true)),
                    )
                } else if (prev) {
                    setCovered(false)
                    if (reducedMotion()) return setShown(null)
                    raf = requestAnimationFrame(() => {
                        const box = sourceBox(prev)
                        if (!box) return setShown(null)
                        play(box, true, () => setShown(null))
                    })
                }
            },
            { defer: true },
        ),
    )

    return (
        <div
            class={`${styles.page} ${props.class ?? ''}`}
            data-enabled={props.enabled ? 'true' : 'false'}
            data-testid="daemon-page"
        >
            <ViewBar
                parts={{ trail: styles.barTrail, readouts: styles.barReadouts }}
                identity={<Crumb icon="Bot">{props.name}</Crumb>}
                locus={
                    <Show when={props.opened}>
                        <Text as="span" size="ui" tone="faint">
                            /
                        </Text>
                        <Text as="span" size="ui">
                            {props.opened}
                        </Text>
                    </Show>
                }
                readouts={
                    <Show when={props.readouts.length > 0}>
                        <Index each={props.readouts}>
                            {(r, i) => (
                                <>
                                    <Show when={i > 0}>
                                        <Text
                                            as="span"
                                            size="ui"
                                            tone="faint"
                                            class={styles.sep}
                                        >
                                            //
                                        </Text>
                                    </Show>
                                    <BarLabel long={r()} />
                                </>
                            )}
                        </Index>
                    </Show>
                }
            />
            <div ref={body} class={styles.body}>
                <div class={styles.stage} data-testid="daemon-page-stage">
                    <div
                        class={styles.rest}
                        data-hidden={covered() ? 'true' : 'false'}
                    >
                        <DaemonHub
                            class={styles.hub}
                            name={props.name}
                            blurb={props.blurb}
                            mood={props.mood}
                            loading={props.loading}
                            enabled={props.enabled}
                            conversing={props.conversing}
                            chatFills={props.chatFills}
                            chat={props.chat}
                            onEditIdentity={props.onEditIdentity}
                        />
                        <Show when={props.enabled}>
                            <div
                                class={styles.panel}
                                data-testid="daemon-page-overview"
                            >
                                {props.overview}
                            </div>
                        </Show>
                    </div>
                </div>
                <Show when={frame()}>
                    {f => (
                        <div
                            ref={frameEl}
                            class={styles.frame}
                            aria-hidden="true"
                        >
                            <Card
                                variant="quiet"
                                attention={f().attention}
                                class={styles.frameBox}
                            />
                        </div>
                    )}
                </Show>
                <Show when={shown()}>
                    <div
                        ref={overlay}
                        class={styles.opened}
                        data-testid="daemon-page-opened"
                        data-moving={covered() ? 'false' : 'true'}
                    >
                        {props.openedView}
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default DaemonPage
