import { createSignal, onCleanup, onMount, type Component } from 'solid-js'
import Text from '../ui/Text'
import AsciiMeter from '../ui/ascii/AsciiMeter'
import { fitMeterWidth } from '../ui/ascii/asciiMeterMath'
import styles from './FlashcardsProgress.module.css'

export type FlashcardsProgressProps = {
    /** Session progress, 0..100. */
    percent: number
    class?: string
}

/**
 * SESSION PROGRESS — the ASCII meter on the deck's own stage (not in the host's view bar: 30 cells
 * is ~210px of glyphs, which no 36px bar band can hold). ACCESSIBILITY: a screen reader spells
 * "[####......]" out character by character, so the wrapper keeps role=progressbar with the numeric
 * value and the glyph run is aria-hidden. Assistive tech hears "45%"; you see the meter.
 *
 * The meter is a fixed character count that cannot reflow, so its cell count is picked against the
 * MEASURED width of its own slot rather than a fraction of the viewport (`vw` is the window, but this
 * lives in a pane). Character width comes from a `ch`-unit probe: `ch` is the CSS spec's own measure
 * of the current font's advance width. THE PROBE MUST DECLARE `font-family: var(--ui-font-stack)`
 * ITSELF — `.meter` sets no font-family, so an undeclared probe would inherit the shell's hardcoded
 * font while the glyph run (`.asc-meter`) gets the settings-driven one. Zero-height + absolutely
 * positioned so it never claims space on the flex line.
 */
const FlashcardsProgress: Component<FlashcardsProgressProps> = props => {
    const [meterCells, setMeterCells] = createSignal(30)
    let meterEl: HTMLDivElement | undefined
    let probeEl: HTMLSpanElement | undefined
    onMount(() => {
        if (!meterEl || !probeEl) return
        const measure = () => {
            // `.isConnected`, not just truthiness — Solid does not null a ref on unmount, so a
            // `document.fonts.ready` resolution landing after unmount would otherwise call
            // `setMeterCells` on a disposed owner.
            if (!meterEl?.isConnected || !probeEl) return
            // clientWidth includes the element's own padding; subtract it for the content box.
            const cs = getComputedStyle(meterEl)
            const availablePx =
                meterEl.clientWidth -
                parseFloat(cs.paddingLeft) -
                parseFloat(cs.paddingRight)
            const chPx = probeEl.getBoundingClientRect().width / 10
            setMeterCells(fitMeterWidth(availablePx, chPx))
        }
        const ro = new ResizeObserver(measure)
        ro.observe(meterEl)
        // Re-measure once the real font has swapped in — the first paint can still be on a
        // fallback font, which would bake a wrong chPx into the initial cell count.
        void document.fonts?.ready?.then(measure).catch(() => {})
        onCleanup(() => ro.disconnect())
    })

    return (
        <div
            ref={el => (meterEl = el)}
            class={`${styles.meter} ${props.class ?? ''}`}
            role="progressbar"
            aria-label="Session progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(props.percent)}
            data-testid="fc-progress"
        >
            <Text as="span" inherit aria-hidden="true">
                <AsciiMeter value={props.percent / 100} width={meterCells()} />
            </Text>
            <Text
                as="span"
                inherit
                ref={el => (probeEl = el)}
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    visibility: 'hidden',
                    width: '10ch',
                    height: '0px',
                    overflow: 'hidden',
                    'pointer-events': 'none',
                    'font-family': 'var(--ui-font-stack)',
                }}
            />
        </div>
    )
}

export default FlashcardsProgress
