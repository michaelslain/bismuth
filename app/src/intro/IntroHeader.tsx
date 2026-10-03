import { Show, type Component } from 'solid-js'
import IconButton from '../ui/IconButton'
import LogoMark from '../ui/LogoMark'
import styles from './IntroHeader.module.css'

export type IntroHeaderProps = {
    icon: string
    /** false on welcome/begin, which already show the big centered mark; the slot stays occupied
     *  so skip stays right-aligned. */
    showMark: boolean
    onSkip: () => void
    class?: string
}

/** The intro's floating top overlay: the corner LogoMark on the left, the skip button on the
 *  right. */
const IntroHeader: Component<IntroHeaderProps> = props => {
    return (
        <header
            class={
                props.class
                    ? `${styles['vi-top']} ${props.class}`
                    : styles['vi-top']
            }
        >
            <Show when={props.showMark} fallback={<div />}>
                <LogoMark icon={props.icon} size={30} label="Bismuth" />
            </Show>
            <IconButton icon="X" label="Skip intro" onClick={props.onSkip} />
        </header>
    )
}

export default IntroHeader
