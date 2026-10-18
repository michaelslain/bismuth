import { For, Show, type Component } from 'solid-js'
import Text from './Text'
import { nearestStop, stepAction, stepIndex } from './stepSliderLogic'
import styles from './StepSlider.module.css'

export type StepSliderProps = {
    stops: { id: string; label: string }[]
    /** null = no stop matches; the trailing `custom` slot lights up. */
    value: string | null
    onChange: (id: string) => void
    /** aria-label */
    label: string
    class?: string
}

/** A stepped level slider on one line: `○` markers joined by a `─` track, the current stop `●` in
 *  accent, a label under each marker. The root is the one focusable `role="slider"`; Left/Right
 *  step, Home/End jump, a click on a marker or label selects it, a drag snaps to the nearest stop.
 *  A trailing `custom` slot (no track into it) lights up when no stop matches; it is a readout, so a
 *  press on it is not a pick. */
const StepSlider: Component<StepSliderProps> = props => {
    const index = () => props.stops.findIndex(s => s.id === props.value)
    const select = (i: number) => {
        const stop = props.stops[i]
        if (stop && stop.id !== props.value) props.onChange(stop.id)
    }
    const stopEls: HTMLElement[] = []
    const pick = (x: number) =>
        nearestStop(
            x,
            stopEls.map(el => {
                const r = el.getBoundingClientRect()
                return r.left + r.width / 2
            }),
        )
    let dragging = false
    return (
        <div
            role="slider"
            tabindex={0}
            aria-label={props.label}
            aria-valuemin={0}
            aria-valuemax={props.stops.length - 1}
            aria-valuenow={index() >= 0 ? index() : undefined}
            aria-valuetext={index() >= 0 ? props.stops[index()]!.label : 'custom'}
            data-testid="step-slider"
            class={[styles.slider, props.class ?? ''].filter(Boolean).join(' ')}
            onKeyDown={e => {
                const action = stepAction(e)
                if (!action) return
                e.preventDefault()
                e.stopPropagation()
                select(stepIndex(props.stops.length, index(), action))
            }}
            onPointerDown={e => {
                if (e.button !== 0) return
                dragging = true
                e.currentTarget.setPointerCapture?.(e.pointerId)
                const hit = (e.target as Element).closest('[data-stop]')?.getAttribute('data-stop')
                const at = props.stops.findIndex(s => s.id === hit)
                select(at >= 0 ? at : pick(e.clientX))
            }}
            onPointerMove={e => {
                if (dragging) select(pick(e.clientX))
            }}
            onPointerUp={() => (dragging = false)}
            onPointerCancel={() => (dragging = false)}
        >
            <For each={props.stops}>
                {(stop, i) => (
                    <span
                        class={styles.stop}
                        data-stop={stop.id}
                        ref={el => (stopEls[i()] = el)}
                    >
                        <Show when={i() > 0}>
                            <span
                                class={[styles.track, i() <= index() ? styles.reached : '']
                                    .filter(Boolean)
                                    .join(' ')}
                                aria-hidden="true"
                            />
                        </Show>
                        <Text
                            as="span"
                            size="inherit"
                            tone={i() === index() ? 'accent' : 'faint'}
                            class={styles.marker}
                        >
                            {i() === index() ? '●' : '○'}
                        </Text>
                        <Text
                            as="span"
                            size="body"
                            tone={i() === index() ? 'default' : 'muted'}
                            class={styles.name}
                            data-on={i() === index() ? '' : undefined}
                        >
                            {stop.label}
                        </Text>
                    </span>
                )}
            </For>
            <span
                class={[styles.stop, styles.custom].join(' ')}
                data-stop-custom
                aria-hidden="true"
                onPointerDown={e => e.stopPropagation()}
            >
                <Text
                    as="span"
                    size="inherit"
                    tone={index() < 0 ? 'accent' : 'faint'}
                    class={styles.marker}
                >
                    {index() < 0 ? '●' : '◌'}
                </Text>
                <Text
                    as="span"
                    size="body"
                    tone={index() < 0 ? 'default' : 'faint'}
                    class={styles.name}
                    data-on={index() < 0 ? '' : undefined}
                >
                    custom
                </Text>
            </span>
        </div>
    )
}

export default StepSlider
