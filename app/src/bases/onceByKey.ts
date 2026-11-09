// Share one load per key: callers asking while it runs get the same promise, and a finished value
// stays. A failure is forgotten so the next caller tries again.
export function onceByKey<A, T>(keyOf: (arg: A) => string, load: (arg: A) => Promise<T>): (arg: A) => Promise<T> {
    const held = new Map<string, Promise<T>>()
    return arg => {
        const key = keyOf(arg)
        const hit = held.get(key)
        if (hit) return hit
        const pending = load(arg)
        held.set(key, pending)
        pending.catch(() => {
            if (held.get(key) === pending) held.delete(key)
        })
        return pending
    }
}
