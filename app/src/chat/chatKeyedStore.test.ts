import { test, expect, beforeEach } from 'bun:test'
import {
    createChatKeyedStore,
    upsertEntry,
    removeEntry,
    lookupEntry,
    type ChatKeyedEntry,
} from './chatKeyedStore'

type Entry = ChatKeyedEntry & { v: string }

const isEntry = (x: unknown): x is Entry =>
    !!x &&
    typeof x === 'object' &&
    typeof (x as Entry).chatId === 'string' &&
    typeof (x as Entry).v === 'string'

const e = (chatId: string, v: string): Entry => ({ chatId, v })

/** Minimal in-memory Storage stub (Bun test env has no localStorage). */
function installMemoryStorage(): Map<string, string> {
    const map = new Map<string, string>()
    ;(globalThis as any).localStorage = {
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        setItem: (k: string, v: string) => {
            map.set(k, String(v))
        },
        removeItem: (k: string) => {
            map.delete(k)
        },
    }
    return map
}
beforeEach(() => {
    installMemoryStorage()
})

test('upsertEntry appends a new entry most-recent last', () => {
    expect(upsertEntry([e('a', '1')], 'b', e('b', '2'), 10)).toEqual([
        e('a', '1'),
        e('b', '2'),
    ])
})

test("upsertEntry replaces an existing chatId's entry and moves it to the end", () => {
    const start = [e('a', '1'), e('b', '2'), e('c', '3')]
    expect(upsertEntry(start, 'a', e('a', 'new'), 10)).toEqual([
        e('b', '2'),
        e('c', '3'),
        e('a', 'new'),
    ])
})

test('upsertEntry caps the list, dropping the oldest', () => {
    const list = Array.from({ length: 5 }, (_, i) => e(`c${i}`, `${i}`))
    const out = upsertEntry(list, 'new', e('new', 'x'), 5)
    expect(out.length).toBe(5)
    expect(out[0].chatId).toBe('c1')
    expect(out[4]).toEqual(e('new', 'x'))
})

test('removeEntry drops the entry; an absent id is a no-op', () => {
    const start = [e('a', '1'), e('b', '2')]
    expect(removeEntry(start, 'a')).toEqual([e('b', '2')])
    expect(removeEntry(start, 'z')).toEqual(start)
})

test('lookupEntry returns the entry, or undefined', () => {
    const list = [e('a', '1'), e('b', '2')]
    expect(lookupEntry(list, 'b')).toEqual(e('b', '2'))
    expect(lookupEntry(list, 'missing')).toBeUndefined()
})

test('store read/write round-trips and filters malformed entries', () => {
    const store = createChatKeyedStore<Entry>('k', 10, isEntry)
    ;(globalThis as any).localStorage.setItem(
        'k',
        JSON.stringify([e('ok', 'v'), { chatId: 3 }, null, 'x']),
    )
    expect(store.read()).toEqual([e('ok', 'v')])
    store.write([e('a', '1')])
    expect(store.read()).toEqual([e('a', '1')])
})

test('store read tolerates malformed JSON', () => {
    const store = createChatKeyedStore<Entry>('k', 10, isEntry)
    ;(globalThis as any).localStorage.setItem('k', '{not json')
    expect(store.read()).toEqual([])
})

test('store read returns [] when localStorage.getItem throws (blocked site data)', () => {
    const throwing = () => {
        throw new DOMException('blocked', 'SecurityError')
    }
    ;(globalThis as any).localStorage = {
        getItem: throwing,
        setItem: throwing,
        removeItem: throwing,
    }
    const store = createChatKeyedStore<Entry>('k', 10, isEntry)
    expect(store.read()).toEqual([])
    expect(() => store.write([e('a', '1')])).not.toThrow()
})

test('store upsert applies its default cap, overridable per call', () => {
    const store = createChatKeyedStore<Entry>('k', 2, isEntry)
    let list = store.upsert([], 'a', e('a', '1'))
    list = store.upsert(list, 'b', e('b', '2'))
    list = store.upsert(list, 'c', e('c', '3'))
    expect(list.map(x => x.chatId)).toEqual(['b', 'c'])
    expect(store.upsert(list, 'd', e('d', '4'), 3).length).toBe(3)
})
