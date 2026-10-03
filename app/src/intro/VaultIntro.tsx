/* app/src/intro/VaultIntro.tsx — first-run "open your vault" intro.
   A full-window takeover shown only on first launch (gated in index.tsx): a short slideshow
   (welcome -> theme -> three brains -> daemon -> agents -> power-ups -> begin).

   This file is state plus composition and nothing else. What each slide says and shows is the
   table in ./introSlides; the pager arithmetic, key mapping, theme painting and the CTA's
   effects are the pure modules ./introPager, ./introKeys, ./introTheme and ./introEnterVault;
   everything it draws is a component (IntroGraph, IntroHeader, IntroHero, IntroCopy,
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
import IntroHero from './IntroHero'
import IntroNav from './IntroNav'
import PowerUpList from './PowerUpList'
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

const VaultIntro: Component<VaultIntroProps> = props => {
    const [index, setIndex] = createSignal(startIndex(SLIDES, props.startAt))
    const [theme, setTheme] = createSignal<ThemeName>(
        props.initialTheme ?? DEFAULT_THEME,
    )
    const [busy, setBusy] = createSignal(false)
    const [powerups, setPowerups] = createSignal(DEFAULT_POWERUPS)
    const slide = () => SLIDES[index()]

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
    onMount(() => window.addEventListener('keydown', onKey))
    onCleanup(() => window.removeEventListener('keydown', onKey))

    return (
        <div class={styles['vi-root']}>
            {/* Two independent graphs that cross-fade (opacity) between the theme + graph
                slides: a small full-bleed starter cloud, and a big condensed "three brains"
                cloud. Separate instances → no shared renderer, no re-render on slide change. */}
            <IntroGraph
                graph={SMALL_GRAPH}
                active={slide().graph === 'small'}
                theme={theme()}
            />
            <IntroGraph
                graph={BIG_GRAPH}
                active={slide().graph === 'big'}
                theme={theme()}
                offsetY={0.12}
                fitMargin={1.55}
            />

            <IntroHeader
                icon={DEFAULTS.appearance.icon}
                showMark={slide().corner}
                onSkip={() => move('skip')}
            />

            <div class={styles['vi-center']} data-layout={slide().layout}>
                {/* Keyed on the slide so the hero and the copy remount each slide change and
                    their enter animation replays; the persistent graphs never remount. */}
                <Show when={slide()} keyed>
                    {s => (
                        <>
                            <Show when={s.hero}>
                                {hero => (
                                    <IntroHero
                                        hero={hero()}
                                        icon={DEFAULTS.appearance.icon}
                                    />
                                )}
                            </Show>
                            <IntroCopy
                                title={s.title}
                                body={s.body}
                                backdrop={!!s.graph}
                            />
                        </>
                    )}
                </Show>

                <Show when={slide().extra === 'cta'}>
                    <IntroCta busy={busy()} onEnter={() => move('next')} />
                </Show>
                <Show when={slide().extra === 'themes'}>
                    <ThemePicker value={theme()} onChange={setTheme} />
                </Show>
                <Show when={slide().extra === 'powerups'}>
                    <PowerUpList
                        items={POWER_UPS}
                        selected={powerups()}
                        onToggle={id =>
                            setPowerups(p => togglePowerUp(p, id))
                        }
                    />
                </Show>

                <IntroNav
                    index={index()}
                    count={SLIDES.length}
                    onPrev={() => move('prev')}
                    onNext={() => move('next')}
                    onSelect={k => move('go', k)}
                    backdrop={!!slide().graph}
                />
            </div>
        </div>
    )
}

export default VaultIntro
