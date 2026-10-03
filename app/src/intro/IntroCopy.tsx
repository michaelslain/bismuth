// The first-run intro's copy block — one slide's headline over its paragraph, set in the prose
// face (a headline and a two-line explanation are what a person READS, not chrome or data).
//
// VaultIntro keys it on the slide, so it remounts per slide and the slide-in enter animation
// (see IntroCopy.module.css) replays; the persistent graph behind it never remounts.
import type { Component } from 'solid-js'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import styles from './IntroCopy.module.css'

export type IntroCopyProps = {
    title: string
    body: string
    /** Graph is painted directly behind the copy: add the --bg text halo + radial scrim. */
    backdrop?: boolean
    class?: string
}

const IntroCopy: Component<IntroCopyProps> = props => {
    return (
        <div
            class={[
                styles['intro-copy'],
                props.backdrop ? styles['intro-copy--backdrop'] : '',
                props.class,
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <Heading level={1} size="hero-xl" register="prose">
                {props.title}
            </Heading>
            <Text size="title" register="prose" class={styles.body}>
                {props.body}
            </Text>
        </div>
    )
}

export default IntroCopy
