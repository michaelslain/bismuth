// Pure helpers for ui/StepSlider (stepSliderLogic.ts, not stepSlider.ts: on a case-insensitive disk that name collides with StepSlider.tsx): which stop a key or a pointer lands on. No framework imports.

export type StepAction = 'prev' | 'next' | 'home' | 'end'

/** The slider's own spatial keys. `null` for anything else, so the caller leaves the event alone. */
export function stepAction(e: { key: string }): StepAction | null {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return 'next'
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return 'prev'
    if (e.key === 'Home') return 'home'
    if (e.key === 'End') return 'end'
    return null
}

/** Index a key moves to. `current` -1 means no stop is selected: stepping lands on the first. Steps
 *  clamp at the ends. Returns -1 when there are no stops. */
export function stepIndex(count: number, current: number, action: StepAction): number {
    if (count <= 0) return -1
    const last = count - 1
    if (action === 'home') return 0
    if (action === 'end') return last
    if (current < 0) return 0
    const next = action === 'next' ? current + 1 : current - 1
    return Math.min(last, Math.max(0, next))
}

/** Index of the stop whose centre is nearest `x`. Ties go to the earlier stop. -1 for no stops. */
export function nearestStop(x: number, centres: number[]): number {
    let best = -1
    let bestDist = Infinity
    centres.forEach((c, i) => {
        const d = Math.abs(c - x)
        if (d < bestDist) {
            best = i
            bestDist = d
        }
    })
    return best
}
