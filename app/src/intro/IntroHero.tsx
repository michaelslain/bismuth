// The first-run intro's per-slide non-graph visual: the wordmark on the welcome/begin slides, a
// terminal panel on the daemon/agents slides. The persistent graph stays mounted behind the
// intro, so this only shows on slides that are not graph slides. The parent remounts it per
// slide, which is what replays the enter animation.
import { Match, Switch, type Component } from 'solid-js'
import TermPanel, { AGENT_LINES, DAEMON_LINES } from './TermPanel'
import WordmarkHero from './WordmarkHero'
import styles from './IntroHero.module.css'

/** The same union as the slide table's `SlideHero`, so a slide's hero can be passed straight in. */
export type IntroHeroKind = 'wordmark' | 'daemon' | 'agents'

export type IntroHeroProps = {
    hero: IntroHeroKind
    /** The logo mark for the wordmark hero (`/logos/<icon>.svg`). */
    icon: string
    class?: string
}

const IntroHero: Component<IntroHeroProps> = props => {
    return (
        <div class={`${styles['vi-hero']}${props.class ? ` ${props.class}` : ''}`}>
            <div class={styles['vi-hero-overlay']}>
                <Switch>
                    <Match when={props.hero === 'wordmark'}>
                        <WordmarkHero icon={props.icon} size={96} />
                    </Match>
                    <Match when={props.hero === 'daemon'}>
                        <TermPanel name="daemon // live" lines={DAEMON_LINES} />
                    </Match>
                    <Match when={props.hero === 'agents'}>
                        {/* The transcript is a real Claude Code session because `claude` is
                            DEFAULT_BACKEND (core/src/agentBackends/catalog.ts) — a session has to be
                            SOME agent, and that is the one most people land on. The panel is labelled
                            "chat" rather than "claude code" so the frame does not contradict the
                            headline; the copy names the rest. */}
                        <TermPanel name="chat" lines={AGENT_LINES} />
                    </Match>
                </Switch>
            </div>
        </div>
    )
}

export default IntroHero
