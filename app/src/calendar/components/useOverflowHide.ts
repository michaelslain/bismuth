import { onMount, onCleanup } from 'solid-js'
import { stepOverflow, type OverflowState } from './overflowLatch'

/** Hides the `meta` row (`setHidden(true)`) when its bottom falls below the `chip`'s client
 *  height — a chip too short for its meta line hides the meta rather than clipping it mid-text —
 *  and shows it again (`setHidden(false)`) when the chip is resized, so widening a pane brings
 *  the location and link back. The release remeasures: still too small, it hides again. */
export function useOverflowHide(
    chip: () => HTMLElement | undefined,
    meta: () => HTMLElement | undefined,
    setHidden: (hidden: boolean) => void,
): void {
    onMount(() => {
        const chipEl = chip()
        const metaEl = meta()
        if (!chipEl || !metaEl) return
        let state: OverflowState = { hidden: false }
        const check = (): void => {
            const next = stepOverflow(state, {
                metaBottom: metaEl.offsetTop + metaEl.offsetHeight,
                chipHeight: chipEl.clientHeight,
                width: chipEl.offsetWidth,
                height: chipEl.offsetHeight,
            })
            if (next.hidden !== state.hidden) setHidden(next.hidden)
            state = next
        }
        const obs = new ResizeObserver(check)
        obs.observe(chipEl)
        obs.observe(metaEl)
        const timer = setTimeout(check, 50)
        onCleanup(() => {
            obs.disconnect()
            clearTimeout(timer)
        })
    })
}
