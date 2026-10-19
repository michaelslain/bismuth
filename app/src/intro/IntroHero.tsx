// The first-run intro's per-slide hero, centred over the slide's copy: the gradient wordmark on the
// welcome and begin slides, and the daemon's status + cron table + log and the agents-to-MCP-to-vault
// diagram as glyph art (the pure scenes in ./glyphScenes, painted by GlyphArt). A glyph hero's box is
// its scene's size at one of two scales (`--intro-glyph-scale` when the window holds it, else 1), so
// the art draws on whole cells and the art box is exactly as tall as the art. The
// parent remounts it per slide, which restarts a scene's reveal.
import { Match, Switch, type Component } from 'solid-js'
import GlyphArt from '../ui/ascii/GlyphArt'
import Wordmark from '../ui/Wordmark'
import { agentsScene } from './glyphScenes/agents'
import { daemonScene } from './glyphScenes/daemon'
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

/** The glyph scene a hero paints, or nothing for the wordmark. */
const sceneOf = (hero: IntroHeroKind) =>
    hero === 'daemon'
        ? daemonScene
        : hero === 'agents'
          ? agentsScene
          : undefined

const IntroHero: Component<IntroHeroProps> = props => {
    return (
        <div
            style={{
                '--hero-rows': String(sceneOf(props.hero)?.rows ?? 0),
                '--hero-cols': String(sceneOf(props.hero)?.cols ?? 0),
            }}
            class={[
                styles['intro-hero'],
                sceneOf(props.hero)
                    ? styles['intro-hero--tall']
                    : '',
                props.className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <Switch>
                <Match when={props.hero === 'wordmark'}>
                    <Wordmark size="hero" />
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
