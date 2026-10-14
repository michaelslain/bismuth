import type { Component } from 'solid-js'
import Band from '../ui/Band'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { footerReadout, nextLabel } from './introFooterText'
import styles from './IntroFooter.module.css'

export type IntroFooterProps = {
    /** 0-based slide index. */
    index: number
    count: number
    /** The slide's label, e.g. `palette`. */
    label: string
    /** Last slide only: the enter action is in flight. */
    busy?: boolean
    /** Last slide only: an Obsidian vault is set to convert, so the enter action converts it. */
    convert?: boolean
    /** Last slide only: the enter action is waiting on a choice (an Obsidian vault to convert). */
    blocked?: boolean
    onPrev: () => void
    /** Also the enter action on the last slide. */
    onNext: () => void
    className?: string
}

/** The intro window's footer band: `2/7 // palette` readout left, `[back] [next]` right. */
const IntroFooter: Component<IntroFooterProps> = props => {
    const isLast = () => props.index >= props.count - 1
    return (
        <Band
            rule="top"
            class={`${styles['footer']} ${props.className ?? ''}`}
        >
            <Text size="ui" tone="muted">
                {footerReadout(props.index, props.count, props.label)}
            </Text>
            <div class={styles['actions']}>
                <TextButton disabled={props.index === 0} onClick={props.onPrev}>
                    back
                </TextButton>
                <TextButton
                    primary
                    disabled={isLast() && (props.busy || props.blocked)}
                    onClick={props.onNext}
                >
                    {nextLabel(
                        props.index,
                        props.count,
                        !!props.busy,
                        !!props.convert,
                    )}
                </TextButton>
            </div>
        </Band>
    )
}

export default IntroFooter
