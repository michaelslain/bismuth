// ---- wordmark hero: the logo mark + the system's one flourish (asc-wordmark sheen) -----
// Replaces the old spinning/glowing crystal — the ASCII register limits itself to ONE
// decorative flourish (the wordmark's gradient sheen, ui.css/patterns.css), so the hero
// IS that flourish, not another glow layered around the logo mark.
import { type Component } from 'solid-js'
import styles from './VaultIntro.module.css'

export type WordmarkHeroProps = {
    icon: string
    size?: number
}

const WordmarkHero: Component<WordmarkHeroProps> = props => {
    const size = () => props.size ?? 96
    return (
        <div class={styles['vi-wordmark-hero']}>
            <img
                src={`/logos/${props.icon}.svg`}
                width={size()}
                height={size()}
                alt=""
            />
            <div class={`asc-wordmark ${styles['vi-wordmark-text']}`}>bismuth</div>
        </div>
    )
}

export default WordmarkHero
