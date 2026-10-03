// The first-run intro's per-slide hero: glyph art that fills the hero box (IntroFrame's hero slot)
// — the wordmark on the welcome slide, the daemon's status + cron table + log on the daemon slide,
// the agents-to-MCP-to-vault diagram on the agents slide, and the formed wordmark over the
// `> open vault_` prompt on the begin slide. The scenes are pure (./glyphScenes/*); GlyphArt paints
// them. The parent remounts it per slide, which restarts the scene's reveal.
import { createMemo, type Component } from 'solid-js'
import GlyphArt from '../ui/ascii/GlyphArt'
import type { GlyphScene } from '../ui/ascii/glyphScene'
import { agentsScene } from './glyphScenes/agents'
import { createBeginScene } from './glyphScenes/begin'
import { daemonScene } from './glyphScenes/daemon'
import { wordmarkScene } from './glyphScenes/wordmark'
import type { SlideHero } from './introSlides'
import { settings } from '../settings'
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

const SCENES: Record<
    Exclude<IntroHeroKind, 'begin'>,
    { scene: GlyphScene; label: string }
> = {
    wordmark: { scene: wordmarkScene, label: 'bismuth' },
    daemon: {
        scene: daemonScene,
        label: 'the daemon running scheduled jobs',
    },
    agents: {
        scene: agentsScene,
        label: 'coding agents connected to your vault over MCP',
    },
}

// The begin prompt's cursor blinks on the app-wide cursor timing, so it is built per render.
const BEGIN_LABEL = 'bismuth // open vault'

const sceneFor = (hero: IntroHeroKind) =>
    hero === 'begin'
        ? {
              scene: createBeginScene(
                  settings.appearance.cursorBlinkSeconds * 1000,
              ),
              label: BEGIN_LABEL,
          }
        : SCENES[hero]

const IntroHero: Component<IntroHeroProps> = props => {
    const hero = createMemo(() => sceneFor(props.hero))
    return (
        <div
            class={`${styles['intro-hero']}${props.className ? ` ${props.className}` : ''}`}
        >
            <GlyphArt
                scene={hero().scene}
                label={hero().label}
                active={props.active}
                at={props.at}
            />
        </div>
    )
}

export default IntroHero
