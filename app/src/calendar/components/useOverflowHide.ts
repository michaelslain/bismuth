import { onMount, onCleanup } from 'solid-js'

/** Latches `onOverflow` once the `meta` row's bottom falls below the `chip`'s client height —
 *  a chip too short for its meta line hides the meta rather than clipping it mid-text. */
export function useOverflowHide(
    chip: () => HTMLElement | undefined,
    meta: () => HTMLElement | undefined,
    onOverflow: () => void,
): void {
    onMount(() => {
        const chipEl = chip()
        const metaEl = meta()
        if (!chipEl || !metaEl) return
        let decided = false
        const check = (): void => {
            if (decided) return
            const metaBottom = metaEl.offsetTop + metaEl.offsetHeight
            if (metaBottom > chipEl.clientHeight + 1) {
                decided = true
                onOverflow()
            }
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
