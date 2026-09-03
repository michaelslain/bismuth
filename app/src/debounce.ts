// Debounce utility: returns a wrapped function that delays invoking `fn`
// until `delay` ms have elapsed since the last call. Reusable across components.
export function debounce<Args extends unknown[]>(
    fn: (...args: Args) => void,
    delay: number | (() => number),
    // Optional ceiling on a resetting burst, mirroring the backend's own
    // flushDelayMs/MAX_COALESCE_INTERVALS (core/src/changeClassifier.ts): without one, a plain
    // resetting debounce is re-armed by every call, so a steady stream (concurrent vault writes)
    // can defer it indefinitely rather than merely coalesce it. Omit it to keep the old behaviour
    // exactly — every existing call site compiles unchanged.
    opts?: { maxWait?: number | (() => number) },
): ((...args: Args) => void) & { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let pending: (() => void) | undefined

    const clearTimers = () => {
        if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
        }
        if (maxTimer !== undefined) {
            clearTimeout(maxTimer)
            maxTimer = undefined
        }
        pending = undefined
    }

    const fire = () => {
        const run = pending
        clearTimers()
        run?.()
    }

    const debounced = (...args: Args) => {
        pending = () => fn(...args)
        if (timer !== undefined) clearTimeout(timer)
        const ms = typeof delay === 'function' ? delay() : delay // read live so settings changes take effect
        timer = setTimeout(fire, ms)
        // Start the ceiling on the FIRST call of a burst only, so it bounds the burst's total span
        // instead of resetting alongside `timer` (which would defeat the point entirely).
        if (opts?.maxWait !== undefined && maxTimer === undefined) {
            const maxMs =
                typeof opts.maxWait === 'function'
                    ? opts.maxWait()
                    : opts.maxWait
            maxTimer = setTimeout(fire, maxMs)
        }
    }

    debounced.cancel = clearTimers

    return debounced
}
