// The first-run intro's call to action: the ONE bracket-primary button in the takeover. It used
// to sit inside the pager row, where the most important action of the whole first run weighed the
// same as a page dot and pushed the row off-centre; it gets its own block under the copy.
import type { Component } from 'solid-js'
import { TextButton } from '../ui/TextButton'
import styles from './IntroCta.module.css'

export type IntroCtaProps = {
    /** The native folder picker is open (or the app is relaunching): disable and say so. */
    busy: boolean
    onEnter: () => void
    class?: string
}

const IntroCta: Component<IntroCtaProps> = props => {
    return (
        <div class={props.class ? `${styles['cta']} ${props.class}` : styles['cta']}>
            <TextButton primary disabled={props.busy} onClick={props.onEnter}>
                {props.busy ? 'opening…' : 'enter your vault'}
            </TextButton>
        </div>
    )
}

export default IntroCta
