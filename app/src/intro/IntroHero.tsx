// The first-run intro's per-slide hero, centred in the art box: the gradient wordmark on the welcome
// slide, the daemon's status + cron table + log and the agents-to-MCP-to-vault diagram as glyph
// art (the pure scenes in ./glyphScenes, painted by GlyphArt), and the wordmark over the
// `> open vault_` prompt on the begin slide. The parent remounts it per slide, which restarts a
// scene's reveal.
import { Match, Switch, type Component } from 'solid-js'
import GlyphArt from '../ui/ascii/GlyphArt'
import Wordmark from '../ui/Wordmark'
import { agentsScene } from './glyphScenes/agents'
import { daemonScene } from './glyphScenes/daemon'
import IntroPrompt from './IntroPrompt'
import type { SlideHero } from './introSlides'
import styles from './IntroHero.module.css'

/** The same union as the slide table's `SlideHero`, so a slide's hero can be passed straight in. */
export type IntroHeroKind = SlideHero

export type IntroHeroProps = {
    hero: IntroHeroKind
    /** Loop runs only while true. Default true. */
    active?: boolean
    /** Pin time (ms): draw one frame, no loop. For stories and baselines. */
    at?: number
    className?: string
}

const IntroHero: Component<IntroHeroProps> = props => {
    return (
        <div
            class={`${styles['intro-hero']}${props.className ? ` ${props.className}` : ''}`}
        >
            <Switch>
                <Match when={props.hero === 'wordmark'}>
                    <Wordmark size="hero" />
                </Match>
                <Match when={props.hero === 'begin'}>
                    <div class={styles.begin}>
                        <Wordmark size="hero" />
                        <div class={styles['begin-prompt']}>
                            <IntroPrompt text="open vault" />
                        </div>
                    </div>
                </Match>
                <Match when={props.hero === 'daemon'}>
                    <GlyphArt
                        scene={daemonScene}
                        label="the daemon running scheduled jobs"
                        active={props.active}
                        at={props.at}
                    />
                </Match>
                <Match when={props.hero === 'agents'}>
                    <GlyphArt
                        scene={agentsScene}
                        label="coding agents connected to your vault over MCP"
                        active={props.active}
                        at={props.at}
                    />
                </Match>
            </Switch>
        </div>
    )
}

export default IntroHero
