/* app/src/intro/VaultIntro.tsx — first-run "open your vault" intro.
   A full-window takeover shown only on first launch (gated in index.tsx): a short slideshow
   (welcome -> theme -> three brains -> daemon -> agents -> pick an agent -> power-ups -> begin).

   This file is state plus composition and nothing else. What each slide says and shows is the
   table in ./introSlides; the pager arithmetic, key mapping, theme painting and the CTA's
   effects are the pure modules ./introPager, ./introKeys, ./introTheme and ./introEnterVault;
   everything it draws is a component (IntroGraph, IntroHeader, IntroFrame, IntroHero, IntroCopy,
   ThemePicker, PowerUpList, IntroCta, IntroNav). Nothing here asks which slide is showing — a
   slide's table row says which pieces it wants.

   The theme step shows a real 3D knowledge graph (dummy unlabeled nodes, the app's own graph
   renderer), and picking a theme recolors it live; the SAME graph carries into the "Three
   brains, one mind" slide. The picked theme also re-themes the whole takeover and seeds the new
   vault's appearance.theme (written by the Tauri `choose_first_vault` command on the CTA).

   A face picker (5 Monaspace variants, plus the serifs for the prose face) was considered but
   deliberately left out: persisting a chosen face into the NEW vault would need either a new
   choose_first_vault argument (a Tauri command-contract change, explicitly out of scope) or a
   post-restart apply step wired in App.tsx. A picker that only live-previewed the intro's own
   text without actually seeding the vault would be misleading, so it's omitted rather than
   half-built. */
import {
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import { DEFAULTS } from '../settings'
import { DEFAULT_THEME, type ThemeName } from '../themes'
import { isTauri } from '../nativeMenu'
import IntroCopy from './IntroCopy'
import IntroCta from './IntroCta'
import IntroGraph from './IntroGraph'
import IntroHeader from './IntroHeader'
import IntroFrame from './IntroFrame'
import IntroHero from './IntroHero'
import IntroNav from './IntroNav'
import PowerUpList from './PowerUpList'
import {
    binariesFor,
    defaultIntroAgent,
    idsForBinaries,
    introAgentOptions,
} from './introAgents'
import { AUTO_ORDER } from '../../../core/src/agentBackends/catalog'
import ThemePicker from './ThemePicker'
import {
    enterVault,
    type EnterVaultChoice,
    type EnterVaultResult,
} from './introEnterVault'
import { introKeyAction } from './introKeys'
import { step, startIndex, type PagerMove } from './introPager'
import {
    DEFAULT_POWERUPS,
    POWER_UPS,
    SLIDES,
    slideBody,
    togglePowerUp,
    type SlideKey,
} from './introSlides'
import { applyIntroTheme, snapshotRootTheme } from './introTheme'
import { SMALL_GRAPH, BIG_GRAPH } from './vaultIntroGraph'
import styles from './VaultIntro.module.css'

export type VaultIntroProps = {
    /** Seeds which slide opens first. The real first run always starts at 'welcome' (the
     *  default); it exists so each slide can be rendered in isolation. */
    startAt?: SlideKey
    /** Seeds the picked theme (real first run: DEFAULT_THEME). Lets a story show a non-ink pick. */
    initialTheme?: ThemeName
    /** Seam for the CTA. Default: introEnterVault.enterVault with the real Tauri/env deps. A
     *  story passes a never-resolving promise to hold the busy state. */
    onEnter?: (choice: EnterVaultChoice) => Promise<EnterVaultResult>
    /** Backend ids already installed on this machine. Given, it replaces detection (stories);
     *  absent, the intro asks the Tauri shell on mount and falls back to none. */
    detectedAgents?: string[]
}

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
const enterWithRealDeps = (choice: EnterVaultChoice) => {
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
    })
}

/** The design window: the 1280x912 the big graph's fit was tuned in, with its 432px hero box. */
const DESIGN_H = 912
const DESIGN_HERO_H = 432
const FIT_DEFAULT = { offsetY: -0.133, fitMargin: 1.96 }

/** Where the big graph must sit to land on the hero box: the box centre relative to the root centre
 *  (as a fraction of the root height) plus the cloud's own asymmetry, and a margin that keeps the
 *  glyph cloud's height in proportion to the box. Both are the graph renderer's host-height
 *  fractions, so they are re-derived from the live rects rather than hardcoded. */
const fitToHero = (root: Element, hero: Element) => {
    const r = root.getBoundingClientRect()
    const h = hero.getBoundingClientRect()
    if (r.height <= 0 || h.height <= 0) return FIT_DEFAULT
    const centreY = h.top + h.height / 2 - r.top
    return {
        offsetY: (centreY - r.height / 2) / r.height + 0.011,
        fitMargin: 1.96 * (r.height / DESIGN_H) * (DESIGN_HERO_H / h.height),
    }
}

const VaultIntro: Component<VaultIntroProps> = props => {
    const [index, setIndex] = createSignal(startIndex(SLIDES, props.startAt))
    const [theme, setTheme] = createSignal<ThemeName>(
        props.initialTheme ?? DEFAULT_THEME,
    )
    const [busy, setBusy] = createSignal(false)
    const [powerups, setPowerups] = createSignal(DEFAULT_POWERUPS)
    const [detected, setDetected] = createSignal<string[]>(
        props.detectedAgents ?? [],
    )
    const [picked, setPicked] = createSignal<string>()
    const agentOptions = createMemo(() => introAgentOptions(detected()))
    // Until the user clicks a card, the choice follows the options (so it lands on the first
    // installed agent once detection returns).
    const agent = () => picked() ?? defaultIntroAgent(agentOptions())
    const noneFound = () => detected().length === 0
    const slide = () => SLIDES[index()]
    let root!: HTMLDivElement
    const [fit, setFit] = createSignal(FIT_DEFAULT)

    // The intro mounts and unmounts inside a running page (Storybook, replay): record :root's
    // theme vars before the first paint below and put them back on the way out.
    onCleanup(snapshotRootTheme())
    // Live re-theme the whole takeover. Persisted only on commit (the CTA), so browsing the
    // picker never pollutes the shared theme cache.
    createEffect(() => applyIntroTheme(theme()))

    const enter = async () => {
        if (busy()) return
        setBusy(true)
        let result: EnterVaultResult = 'failed'
        try {
            result = await (props.onEnter ?? enterWithRealDeps)({
                theme: theme(),
                icon: DEFAULTS.appearance.icon,
                powerups: powerups(),
                agent: agent(),
            })
        } finally {
            // 'opened' leaves the intro busy: the app is relaunching (or navigating) away.
            if (result !== 'opened') setBusy(false)
        }
    }

    const move = (m: PagerMove, target?: number) => {
        const next = step(index(), SLIDES.length, m, target)
        setIndex(next.index)
        if (next.enter) void enter()
    }

    const onKey = (e: KeyboardEvent) => {
        const action = introKeyAction(e)
        if (!action) return
        e.preventDefault()
        move(action)
    }
    onMount(() => {
        const hero = root.querySelector('[data-intro-slot="hero"]')
        if (!hero) return
        const measure = () => setFit(fitToHero(root, hero))
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(root)
        ro.observe(hero)
        onCleanup(() => ro.disconnect())
    })
    onMount(() => {
        if (props.detectedAgents) return
        void detectInstalledAgents().then(setDetected)
    })
    onMount(() => window.addEventListener('keydown', onKey))
    onCleanup(() => window.removeEventListener('keydown', onKey))

    return (
        <div class={styles['vi-root']} ref={root}>
            {/* Two independent graphs that cross-fade (opacity) between the theme + graph
                slides: a small full-bleed starter cloud, and a big condensed "three brains"
                cloud. Separate instances → no shared renderer, no re-render on slide change. */}
            <IntroGraph
                graph={SMALL_GRAPH}
                active={slide().graph === 'small'}
                theme={theme()}
            />
            {/* offsetY / fitMargin anchor the big cloud to the hero box, not to the window: they are
                fractions of the host (= root) height H, while the box is fixed px, so they are
                derived from the box's measured rect (see fitToHero) and follow a resize.
                offsetY: the box centre's distance from the window centre, as a fraction of H, +0.011
                for the cloud not being symmetric about its origin (measured at 1280x912: the glyph
                centre landed 0.011 H low). fitMargin: the glyph cloud's height is proportional to H
                / fitMargin, so the margin scales with H and inversely with the box height; 1.96 is
                the value that fits the 432px box at H = 912 with ~60px clear above the headline. */}
            <IntroGraph
                graph={BIG_GRAPH}
                active={slide().graph === 'big'}
                theme={theme()}
                offsetY={fit().offsetY}
                fitMargin={fit().fitMargin}
            />

            <IntroHeader
                icon={DEFAULTS.appearance.icon}
                showMark={slide().corner}
                onSkip={() => move('skip')}
            />

            <div class={styles['vi-stage']}>
                {/* One frame for every slide: the same grid, so the hero box, the headline and the
                    nav never move between slides. The hero and the copy are keyed on the slide so
                    they remount each change and their enter animation replays; the frame, the nav
                    (and the keyboard focus on it) and the persistent graphs never remount. */}
                <IntroFrame
                    variant={
                        slide().extra === 'themes' ||
                        slide().extra === 'pickagent' ||
                        slide().extra === 'powerups'
                            ? 'setup'
                            : 'hero'
                    }
                    hero={
                        <Show when={slide()} keyed>
                            {s => (
                                <>
                                    <Show when={s.hero}>
                                        {hero => <IntroHero hero={hero()} />}
                                    </Show>
                                    <Show when={s.extra === 'themes'}>
                                        <ThemePicker
                                            value={theme()}
                                            onChange={setTheme}
                                        />
                                    </Show>
                                    <Show when={s.extra === 'pickagent'}>
                                        <PowerUpList
                                            single
                                            items={agentOptions()}
                                            selected={[agent()]}
                                            onToggle={setPicked}
                                        />
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
                                <>
                                    <IntroCopy
                                        title={s.title}
                                        body={slideBody(s, noneFound())}
                                        backdrop={!!s.graph}
                                    />
                                    <Show when={s.extra === 'cta'}>
                                        <IntroCta
                                            busy={busy()}
                                            onEnter={() => move('next')}
                                        />
                                    </Show>
                                </>
                            )}
                        </Show>
                    }
                    nav={
                        <IntroNav
                            index={index()}
                            count={SLIDES.length}
                            onPrev={() => move('prev')}
                            onNext={() => move('next')}
                            onSelect={k => move('go', k)}
                            backdrop={!!slide().graph}
                        />
                    }
                />
            </div>
        </div>
    )
}

export default VaultIntro
