import { For, splitProps, type Component } from 'solid-js'
import PlainButton from './PlainButton'
import styles from './PagerDots.module.css'

export type PagerDotsProps = {
    count: number
    /** 0-based current page; that dot gets aria-current="step" and the accent fill. */
    index: number
    onSelect: (i: number) => void
    /** Accessible name per dot. Default i => `Go to slide ${i + 1}`. */
    label?: (i: number) => string
    class?: string
}

/** A row of round page dots; the current one is accent-filled and marked `aria-current="step"`. */
const PagerDots: Component<PagerDotsProps> = props => {
    const [local] = splitProps(props, [
        'count',
        'index',
        'onSelect',
        'label',
        'class',
    ])
    const name = (i: number) =>
        local.label ? local.label(i) : `Go to slide ${i + 1}`
    return (
        <div class={`${styles['dots']} ${local.class ?? ''}`}>
            <For each={Array.from({ length: local.count }, (_, k) => k)}>
                {k => (
                    <PlainButton
                        class={styles['dot']}
                        classList={{ [styles['on']]: k === local.index }}
                        aria-label={name(k)}
                        aria-current={k === local.index ? 'step' : undefined}
                        onClick={() => local.onSelect(k)}
                    />
                )}
            </For>
        </div>
    )
}

export default PagerDots
