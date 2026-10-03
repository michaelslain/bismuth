// app/src/createKeyedSignal.ts
// A reactive id → value map: one signal holding an immutable Map, replaced (never mutated) on a real
// change so readers re-run only when something actually moved. `set` of an equal value and `clear` of
// an absent id return the SAME Map, so a republish (e.g. a draft flag on every keystroke) invalidates
// nobody. Behind chatActivity / chatTitles / chatOrigin.
import { createSignal, type Accessor } from 'solid-js'

export type KeyedSignal<V> = {
    /** The value for `id`, or undefined. Reactive. */
    get(id: string): V | undefined
    /** Store `v` for `id`. A no-op when the stored value is already `v`. */
    set(id: string, v: V): void
    /** Drop `id`. A no-op when absent. */
    clear(id: string): void
    /** The whole map, reactive. */
    map: Accessor<ReadonlyMap<string, V>>
}

export function createKeyedSignal<V>(): KeyedSignal<V> {
    const [map, setMap] = createSignal<ReadonlyMap<string, V>>(new Map())
    return {
        get: id => map().get(id),
        set: (id, v) =>
            setMap(m => {
                if (m.has(id) && m.get(id) === v) return m
                const next = new Map(m)
                next.set(id, v)
                return next
            }),
        clear: id =>
            setMap(m => {
                if (!m.has(id)) return m
                const next = new Map(m)
                next.delete(id)
                return next
            }),
        map,
    }
}
