// ---- wordmark hero: the logo mark + the system's one flourish (asc-wordmark sheen) -----
// The ASCII register limits itself to ONE decorative flourish (the wordmark's gradient sheen,
// global.css's `App.css` section), so the hero IS that flourish, not another glow layered around
// the logo mark. Composes ui/LogoMark + ui/Wordmark; this file only owns the column.
import { type Component } from 'solid-js'
import LogoMark from '../ui/LogoMark'
import Wordmark from '../ui/Wordmark'
import styles from './WordmarkHero.module.css'

export type WordmarkHeroProps = {
    icon: string
    size?: number
}

const WordmarkHero: Component<WordmarkHeroProps> = props => {
    return (
        <div class={styles['vi-wordmark-hero']}>
            <LogoMark icon={props.icon} size={props.size ?? 96} />
            <Wordmark size="hero" />
        </div>
    )
}

export default WordmarkHero
