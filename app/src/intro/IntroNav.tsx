import { Show, type Component } from 'solid-js'
import IconButton from '../ui/IconButton'
import PagerDots from '../ui/PagerDots'
import styles from './IntroNav.module.css'

export type IntroNavProps = {
    index: number
    count: number
    onPrev: () => void
    onNext: () => void
    onSelect: (i: number) => void
    /** Graph behind the row: add the --bg drop-shadow so the dots stay visible. */
    backdrop?: boolean
    class?: string
}

/** Back / dots / Next row, with the dots centred on the stage on every slide. */
const IntroNav: Component<IntroNavProps> = props => {
    const isLast = () => props.index >= props.count - 1
    return (
        <div
            class={`${styles['nav']} ${props.backdrop ? styles['backdrop'] : ''} ${props.class ?? ''}`}
        >
            <IconButton
                icon="ArrowLeft"
                label="Back"
                size="md"
                onClick={props.onPrev}
                disabled={props.index === 0}
            />
            <PagerDots
                count={props.count}
                index={props.index}
                onSelect={props.onSelect}
            />
            <Show
                when={!isLast()}
                fallback={
                    <IconButton
                        class={styles['spacer']}
                        icon="ArrowRight"
                        label="Next"
                        variant="selected"
                        size="md"
                        aria-hidden="true"
                        tabindex={-1}
                        disabled
                    />
                }
            >
                <IconButton
                    icon="ArrowRight"
                    label="Next"
                    variant="selected"
                    size="md"
                    onClick={props.onNext}
                />
            </Show>
        </div>
    )
}

export default IntroNav
