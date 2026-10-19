/* app/src/intro/VaultIntro.tsx — first-run "open your vault" intro.
   A full-window takeover shown only on first launch (gated in index.tsx): a short slideshow
   (welcome -> theme -> three brains -> daemon -> agents -> pick an agent -> power-ups -> name your
   daemon -> obsidian -> chat -> settings -> begin). The slides after power-ups that describe a
   power-up show only while it is selected (`requires` in the table; visibleSlides), so the pager
   and the footer count run over the visible list.

   This file is state plus composition and nothing else. What each slide says and shows is the
   table in ./introSlides; the pager arithmetic, key mapping, theme painting and the CTA's
   effects are the pure modules ./introPager, ./introKeys, ./introTheme and ./introEnterVault;
   everything it draws is a component (IntroWindow, IntroFooter, IntroGraph, IntroHero, IntroCopy,
   ThemePicker, PowerUpList, DaemonNameField, SettingsSamples). Nothing here asks which slide is showing — a
   slide's table row says which pieces it wants.

   The graph slide draws a real 3D knowledge graph inside its art box (dummy unlabeled nodes, the
   app's own graph renderer). The picked theme re-themes the whole takeover and seeds the new
   vault's appearance.theme (written by the Tauri `choose_first_vault` command on the last slide's primary button).

   A face picker (5 Monaspace variants, plus the serifs for the prose face) was considered but
   deliberately left out: persisting a chosen face into the NEW vault would need either a new
   choose_first_vault argument (a Tauri command-contract change, explicitly out of scope) or a
   post-restart apply step wired in App.tsx. A picker that only live-previewed the intro's own
   text without actually seeding the vault would be misleading, so it's omitted rather than
   half-built. */
// The global layer (tokens, element reset, @font-face) is otherwise imported only by App.tsx, and
// index.tsx's first-run branch never loads App: without this the takeover renders with every
// --sp-*/--row-h/--cell-w undefined. First, so it precedes every intro module's rules as in App.
import '../global.css'
import {
    Show,
    batch,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import { DEFAULTS } from '../settings'
import { DEFAULT_THEME, type ThemeName } from '../themes'
import { isTauri } from '../platform'
import { pickFolder } from '../appWindow'
import IntroCopy from './IntroCopy'
import IntroGraph, { type IntroGraphStage } from './IntroGraph'
import IntroFooter from './IntroFooter'
import IntroHero from './IntroHero'
import IntroWindow from './IntroWindow'
import MorphOverlay from './MorphOverlay'
import PowerUpList from './PowerUpList'
import PrivacyPicker from './PrivacyPicker'
import { DEFAULT_PRIVACY, type PrivacyValues } from './introPrivacy'
import DaemonNameField from './DaemonNameField'
import ObsidianSourceField, { type VaultStart } from './ObsidianSourceField'
import SettingsSamples from './SettingsSamples'
import {
    binariesFor,
    defaultIntroAgent,
    idsForBinaries,
    introAgentOptions,
} from './introAgents'
import { AUTO_ORDER } from '../../../core/src/agentBackends/catalog'
import ThemePicker from './ThemePicker'
import {
    convertSourceMissing,
    enterVault,
    type EnterVaultChoice,
    type EnterVaultResult,
} from './introEnterVault'
import { introKeyAction } from './introKeys'
import { step, startIndex, type PagerMove } from './introPager'
import {
    DEFAULT_POWERUPS,
    POWER_UPS,
    slideBody,
    togglePowerUp,
    visibleSlides,
    type SlideKey,
} from './introSlides'
import { applyIntroTheme, snapshotRootTheme } from './introTheme'
import { BIG_GRAPH } from './vaultIntroGraph'
import {
    MORPH_IDLE,
    frameToGrid,
    morphOnMove,
    morphProgress,
    type MorphState,
} from './introMorph'
import { agentsScene } from './glyphScenes/agents'
import { daemonScene } from './glyphScenes/daemon'
import { createFrame } from '../ui/ascii/glyphScene'
import { MORPH_MS, writeMorphFrame, type MorphGlyph } from './morph/morphFrame'
import type { MorphGrid } from './morph/morphGrid'
import { planMorph, type MorphPlan } from './morph/morphPlan'
import { readMetrics, snapshotSlide } from './morph/snapshotSlide'
import styles from './VaultIntro.module.css'

export type VaultIntroProps = {
    /** Seeds which slide opens first. The real first run always starts at 'welcome' (the
     *  default); it exists so each slide can be rendered in isolation. */
    startAt?: SlideKey
    /** Seeds the picked theme (real first run: DEFAULT_THEME). Lets a story show a non-ink pick. */
    initialTheme?: ThemeName
    /** Seam for the CTA. Default: introEnterVault.enterVault with the real Tauri/env deps. A
     *  story passes a never-resolving promise to hold the busy state. */
    onEnter?: (
        choice: EnterVaultChoice,
        onError: (message: string) => void,
    ) => Promise<EnterVaultResult>
    /** Backend ids already installed on this machine. Given, it replaces detection (stories);
     *  absent, the intro asks the Tauri shell on mount and falls back to none. */
    detectedAgents?: string[]
    /** Seeds the selected power-ups (real first run: DEFAULT_POWERUPS). Lets a story show the
     *  slides a cleared power-up hides. */
    initialPowerups?: string[]
    /** Seeds the Obsidian vault to convert. Lets a story show the picked state and the CTA. */
    initialObsidianSource?: string
    /** Seeds the new vault / from obsidian choice (default: `from obsidian` when a source is
     *  seeded, else `new vault`). Lets a story show `from obsidian` with nothing picked. */
    initialVaultStart?: VaultStart
    /** Seeds the privacy switches (real first run: DEFAULT_PRIVACY, everything off). */
    initialPrivacy?: PrivacyValues
    /** Whether a slide move runs the morph (default true). False cuts instantly (stories whose
     *  play function steps slides and asserts text). A number freezes the morph at that progress
     *  once its incoming slide is measured: the deterministic seam for a mid-flight still. */
    morph?: boolean | number
}

/** How long the real slide takes to fade in under the overlay, and where in the morph it starts:
 *  just after the last char lands (morphFrame's last landing is at 0.78), so the slide resolves under
 *  a settled overlay that is still painting its final frame. */
const FADE_MS = 450
const FADE_AT = 0.8

/** What the morph carries: the slide body (backdrop, art and text slots) and the footer's
 *  `n/12 // name` readout, which change per slide. The wordmark, [skip] and the footer's buttons are
 *  the same on every slide and stay on screen at full opacity, so the snapshot leaves them out and
 *  the overlay never paints them twice. VaultIntro.module.css fades exactly this selector. */
const MORPH_SCOPE =
    "[data-intro-slot='backdrop'], [data-intro-slot='art'], [data-intro-slot='text'], [data-intro-slot='footer'] > * > :not(:has(button))"

const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where a glyph hero's reveal ends, so a morph-arrived slide shows its finished frame. */
const revealMsOf = (hero: string): number =>
    hero === 'daemon'
        ? daemonScene.revealMs
        : hero === 'agents'
          ? agentsScene.revealMs
          : 0

/** Ask the Tauri shell which agent CLIs are installed (the intro has no backend to ask). Outside
 *  the desktop app, or if the call throws, nothing is detected: only the free agent is offered. */
const detectInstalledAgents = async (): Promise<string[]> => {
    if (!isTauri()) return []
    try {
        const { invoke } = await import('@tauri-apps/api/core')
        const found = await invoke<string[]>('detect_agents', {
            binaries: binariesFor(AUTO_ORDER),
        })
        return idsForBinaries(found)
    } catch {
        return []
    }
}

/** The CTA with the real effects: the Tauri command, localStorage, and a hard navigation. */
const enterWithRealDeps = (
    choice: EnterVaultChoice,
    onError: (message: string) => void,
) => {
    let storage: Storage | undefined
    try {
        storage = localStorage
    } catch {
        /* private mode — the persisted choices are best-effort */
    }
    return enterVault(choice, {
        dev: import.meta.env.DEV,
        tauri: isTauri(),
        invoke: async (cmd, args) => {
            const { invoke } = await import('@tauri-apps/api/core')
            return invoke<boolean>(cmd, args)
        },
        storage,
        navigate: href => {
            location.href = href
        },
        log: console,
        onError,
    })
}

const VaultIntro: Component<VaultIntroProps> = props => {
    const [powerups, setPowerups] = createSignal(
        props.initialPowerups ?? DEFAULT_POWERUPS,
    )
    const slides = createMemo(() => visibleSlides(powerups()))
    const [index, setIndex] = createSignal(
        startIndex(slides(), props.startAt),
    )
    const [privacy, setPrivacy] = createSignal<PrivacyValues>(
        props.initialPrivacy ?? DEFAULT_PRIVACY,
    )
    const [daemonName, setDaemonName] = createSignal('')
    const [obsidianSource, setObsidianSource] = createSignal(
        props.initialObsidianSource ?? '',
    )
    // `new vault` unless the user picks `from obsidian` (a story seeding a source starts there).
    const [vaultStart, setVaultStart] = createSignal<VaultStart>(
        props.initialVaultStart ??
            (props.initialObsidianSource ? 'obsidian' : 'new'),
    )
    // The source a conversion would use: only when `from obsidian` is picked AND cli + mcp is on
    // (the obsidian slide shows only then), so the CTA offers a conversion only then too.
    const convertSource = () =>
        powerups().includes('cli') && vaultStart() === 'obsidian'
            ? obsidianSource()
            : ''
    const converting = () => !!convertSource().trim()
    // `from obsidian` with nothing picked: the CTA waits for a vault rather than opening the folder
    // picker, which would read as a second, different pick.
    const sourceMissing = () =>
        convertSourceMissing(powerups(), vaultStart(), obsidianSource())
    const [theme, setTheme] = createSignal<ThemeName>(
        props.initialTheme ?? DEFAULT_THEME,
    )
    const [busy, setBusy] = createSignal(false)
    // Why the last enter failed (Rust refusing a typed Obsidian path), shown as the last slide's
    // body until the next attempt.
    const [enterError, setEnterError] = createSignal('')
    const [detected, setDetected] = createSignal<string[]>(
        props.detectedAgents ?? [],
    )
    const [picked, setPicked] = createSignal<string>()
    const agentOptions = createMemo(() => introAgentOptions(detected()))
    // Until the user clicks a card, the choice follows the options (so it lands on the first
    // installed agent once detection returns).
    const agent = () => picked() ?? defaultIntroAgent(agentOptions())
    const noneFound = () => detected().length === 0
    const slide = () => slides()[index()]
    /** Where the intro graph stands on this slide, or nothing: at full strength over the art on the
     *  palette slide (so a theme pick shows on it) and the three-brains slide. */
    const graphStage = (): IntroGraphStage | undefined =>
        slide().key === 'theme' || slide().key === 'graph' ? 'hero' : undefined

    // The intro mounts and unmounts inside a running page (Storybook, replay): record :root's
    // theme vars before the first paint below and put them back on the way out.
    onCleanup(snapshotRootTheme())
    // Live re-theme the whole takeover. Persisted only on commit (the CTA), so browsing the
    // picker never pollutes the shared theme cache.
    createEffect(() => applyIntroTheme(theme()))

    const enter = async () => {
        if (busy() || sourceMissing()) return
        setBusy(true)
        setEnterError('')
        let result: EnterVaultResult = 'failed'
        try {
            result = await (props.onEnter ?? enterWithRealDeps)(
                {
                    theme: theme(),
                    icon: DEFAULTS.appearance.icon,
                    powerups: powerups(),
                    agent: agent(),
                    daemonName: daemonName(),
                    obsidianSource: convertSource(),
                    privacy: privacy(),
                },
                setEnterError,
            )
        } finally {
            // 'opened' leaves the intro busy: the app is relaunching (or navigating) away.
            if (result !== 'opened') setBusy(false)
        }
    }

    // ---- the morph ------------------------------------------------------------------------------
    // A move snapshots the outgoing slide synchronously, switches the slide (laid out at opacity 0
    // under the overlay), snapshots it on the next frame, then flies the overlay from one grid to
    // the other and fades the real slide in beneath it. A press mid-flight retargets from the
    // characters on screen. One slide tree throughout.
    let root!: HTMLDivElement
    const [morphing, setMorphing] = createSignal<'off' | 'run' | 'fade'>('off')
    const [plan, setPlan] = createSignal<MorphPlan>()
    const [progress, setProgress] = createSignal(0)
    const [seed, setSeed] = createSignal(1)
    // The slide on screen was reached by a morph: its copy does not type and its glyph hero starts
    // from its finished frame.
    const [arrived, setArrived] = createSignal(false)
    const [heroT, setHeroT] = createSignal(0)
    let state: MorphState = MORPH_IDLE
    let shownP = 0
    let token = 0
    let raf = 0
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    let heroTimer: ReturnType<typeof setInterval> | undefined
    let moves = 0

    const stopTimers = () => {
        token++
        cancelAnimationFrame(raf)
        clearTimeout(fadeTimer)
        clearInterval(heroTimer)
        heroTimer = undefined
    }
    onCleanup(stopTimers)

    const finish = () => {
        setMorphing('off')
        setPlan(undefined)
        state = MORPH_IDLE
        // The hero goes live from its finished frame (a pinned time that advances at ambient pace).
        const t0 = performance.now()
        heroTimer = setInterval(() => setHeroT(performance.now() - t0), 83)
    }

    const fly = (my: number, from: MorphGrid, frozen: number | undefined) => {
        const to = snapshotSlide(root, readMetrics(root), MORPH_SCOPE)
        if (my !== token) return
        setPlan(planMorph(from, to, seed()))
        if (frozen !== undefined) {
            shownP = frozen
            setProgress(frozen)
            return
        }
        state =
            state.phase === 'running'
                ? { ...state, startedAt: performance.now() }
                : state
        const tick = (now: number) => {
            if (my !== token) return
            const p = morphProgress(state, now)
            shownP = p
            setProgress(p)
            if (p >= FADE_AT && morphing() === 'run') setMorphing('fade')
            if (p >= 1) {
                fadeTimer = setTimeout(
                    finish,
                    Math.max(0, FADE_MS - (1 - FADE_AT) * MORPH_MS),
                )
            } else raf = requestAnimationFrame(tick)
        }
        tick(performance.now())
    }

    /** Switch to slide `to`, with the morph when it applies. */
    const goTo = (to: number) => {
        const from = index()
        const frozen = typeof props.morph === 'number' ? props.morph : undefined
        const now = performance.now()
        const next =
            props.morph === false || !root
                ? MORPH_IDLE
                : morphOnMove(
                      state,
                      from,
                      to,
                      now,
                      // A frozen still is not motion: it shows under reduced motion too.
                      frozen === undefined && prefersReducedMotion(),
                  )
        if (next.phase === 'idle') {
            stopTimers()
            batch(() => {
                setIndex(to)
                setMorphing('off')
                setPlan(undefined)
                setArrived(false)
                setHeroT(0)
            })
            state = MORPH_IDLE
            return
        }
        // What is on screen now: the live slide, or the overlay's current frame when retargeting.
        const current = plan()
        let fromGrid: MorphGrid
        if (state.phase === 'running' && current) {
            const f = createFrame(current.cols, current.rows)
            const fitted: MorphGlyph[] = []
            writeMorphFrame(current, shownP, seed(), f, fitted)
            const onGrid = frameToGrid(f)
            // the text in flight keeps its footprint, so the new flight starts where it is drawn
            const text = fitted.map(({ col, row, ch, color, x, y, scale }) => ({ col, row, ch, color, x, y, scale }))
            fromGrid = { ...onGrid, cells: [...onGrid.cells, ...text] }
        } else {
            fromGrid = snapshotSlide(root, readMetrics(root), MORPH_SCOPE)
        }
        stopTimers()
        state = next
        moves++
        const my = token
        batch(() => {
            setSeed(frozen !== undefined ? 1 : moves)
            setIndex(to)
            setArrived(true)
            setHeroT(0)
            setProgress(0)
            setPlan(planMorph(fromGrid, fromGrid, seed()))
            setMorphing('run')
        })
        // The incoming slide is laid out (at opacity 0) by the next frame.
        raf = requestAnimationFrame(() => fly(my, fromGrid, frozen))
    }

    const move = (m: PagerMove, target?: number) => {
        const next = step(index(), slides().length, m, target)
        if (next.index !== index()) goTo(next.index)
        if (next.enter) void enter()
    }

    const onKey = (e: KeyboardEvent) => {
        const action = introKeyAction(e)
        if (!action) return
        e.preventDefault()
        move(action)
    }
    onMount(() => {
        if (props.detectedAgents) return
        void detectInstalledAgents().then(setDetected)
    })
    onMount(() => window.addEventListener('keydown', onKey))
    onCleanup(() => window.removeEventListener('keydown', onKey))

    return (
        <div
            ref={root}
            class={styles['vi-root']}
            data-morphing={morphing() === 'off' ? undefined : morphing()}
        >
            <IntroWindow
                onClose={() => move('skip')}
                artFill={!!graphStage()}
                backdrop={
                    // ONE graph for the palette and three-brains slides: the condition stays true
                    // across that step, so the instance persists and just changes stage.
                    <Show when={graphStage()}>
                        {stage => (
                            <IntroGraph
                                graph={BIG_GRAPH}
                                active
                                stage={stage()}
                                theme={theme()}
                            />
                        )}
                    </Show>
                }
                art={
                    <Show when={slide()} keyed>
                        {s => (
                            <>
                                <Show when={s.hero}>
                                    {hero => (
                                        <IntroHero
                                            hero={hero()}
                                            at={
                                                arrived()
                                                    ? revealMsOf(hero()) +
                                                      heroT()
                                                    : undefined
                                            }
                                        />
                                    )}
                                </Show>
                                <Show when={graphStage()}>
                                    <div class={styles['graph-room']}>
                                        <Show when={s.extra === 'themes'}>
                                            <ThemePicker
                                                value={theme()}
                                                onChange={setTheme}
                                            />
                                        </Show>
                                    </div>
                                </Show>
                                <Show when={s.extra === 'pickagent'}>
                                    <PowerUpList
                                        single
                                        items={agentOptions()}
                                        selected={[agent()]}
                                        onToggle={setPicked}
                                    />
                                </Show>
                                <Show when={s.extra === 'name'}>
                                    <DaemonNameField
                                        value={daemonName()}
                                        onInput={setDaemonName}
                                        onSubmit={() => move('next')}
                                    />
                                </Show>
                                <Show when={s.extra === 'privacy'}>
                                    <div class={styles['privacy-room']}>
                                        <PrivacyPicker
                                            values={privacy()}
                                            onChange={setPrivacy}
                                        />
                                    </div>
                                </Show>
                                <Show when={s.extra === 'obsidian'}>
                                    <ObsidianSourceField
                                        start={vaultStart()}
                                        onStartChange={setVaultStart}
                                        value={obsidianSource()}
                                        onInput={setObsidianSource}
                                        onBrowse={() =>
                                            void pickFolder().then(r => {
                                                if (r.status === 'picked')
                                                    setObsidianSource(r.path)
                                            })
                                        }
                                    />
                                </Show>
                                <Show when={s.extra === 'samples'}>
                                    <SettingsSamples />
                                </Show>
                                <Show when={s.extra === 'powerups'}>
                                    <PowerUpList
                                        items={POWER_UPS}
                                        selected={powerups()}
                                        onToggle={id =>
                                            setPowerups(p =>
                                                togglePowerUp(p, id),
                                            )
                                        }
                                    />
                                </Show>
                            </>
                        )}
                    </Show>
                }
                text={
                    <Show when={slide()} keyed>
                        {s => (
                            <IntroCopy
                                type={!arrived()}
                                title={s.title}
                                body={
                                    s.extra !== 'cta'
                                        ? slideBody(s, noneFound())
                                        : sourceMissing()
                                          ? 'Pick the Obsidian vault to convert on the obsidian slide, or switch it to new vault.'
                                          : enterError()
                                            ? `Couldn't open the vault: ${enterError()}`
                                            : slideBody(s, noneFound())
                                }
                            />
                        )}
                    </Show>
                }
                footer={
                    <IntroFooter
                        index={index()}
                        count={slides().length}
                        label={slide().label}
                        busy={busy()}
                        convert={converting() || sourceMissing()}
                        blocked={sourceMissing()}
                        onPrev={() => move('prev')}
                        onNext={() => move('next')}
                    />
                }
            />
            <Show when={plan()}>
                {p => (
                    <MorphOverlay
                        plan={p()}
                        progress={progress()}
                        seed={seed()}
                    />
                )}
            </Show>
        </div>
    )
}

export default VaultIntro
