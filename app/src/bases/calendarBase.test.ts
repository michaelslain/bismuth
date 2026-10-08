import { test, expect, beforeEach } from 'bun:test'
import { BaseBackend } from './calendarBase'
import { toasts, dismissToast } from '../ui/toastStore'
import { parseCalendarFile, serializeCalendarFile } from './calendarSerialize'

let disk: string | null = null
const writes: string[] = []
const io = {
    read: async (_p: string) => {
        if (disk === null) throw new Error('ENOENT')
        return disk
    },
    write: async (_p: string, t: string) => {
        disk = t
        writes.push(t)
    },
}

const ev = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: id,
    date: '2026-05-30',
    ...extra,
})
const fm = { type: 'base', view: 'calendar' }
const file = (events: any[], format: 'md' | 'jsonl', f: any = fm) =>
    serializeCalendarFile(f, events, format)
const ids = () => parseCalendarFile(disk!).events.map(e => e.id)

beforeEach(() => {
    disk = null
    writes.length = 0
})

for (const format of ['jsonl', 'md'] as const) {
    test(`${format} stays ${format} after an app edit`, async () => {
        disk = file([ev('a'), ev('b')], format)
        const b = new BaseBackend('x', io)
        await b.init()
        const d = b.load()!
        d.events[0] = { ...d.events[0], title: 'edited' }
        b.save(d)
        await b.reloadIfChanged()
        expect(parseCalendarFile(disk).format).toBe(format)
        expect(parseCalendarFile(disk).events[0].title).toBe('edited')
    })

    test(`${format}: external add survives an app edit`, async () => {
        disk = file([ev('a'), ev('b')], format)
        const b = new BaseBackend('x', io)
        await b.init()
        disk = file([ev('a'), ev('b'), ev('ext')], format)
        const d = b.load()!
        d.events[0] = { ...d.events[0], title: 'edited' }
        b.save(d)
        expect(await b.reloadIfChanged()).toBe(true) // app picks up the external event
        const out = parseCalendarFile(disk)
        expect(out.events.map(e => e.id).sort()).toEqual(['a', 'b', 'ext'])
        expect(out.events.find(e => e.id === 'a')!.title).toBe('edited')
        expect(b.load()!.events.length).toBe(3)
    })

    test(`${format}: external category change survives an app edit`, async () => {
        disk = file([ev('a', { category: 'Work' }), ev('b')], format)
        const b = new BaseBackend('x', io)
        await b.init()
        disk = file([ev('a', { category: 'Home' }), ev('b')], format)
        const d = b.load()!
        d.events[1] = { ...d.events[1], title: 'edited' }
        b.save(d)
        await b.reloadIfChanged()
        const out = parseCalendarFile(disk).events
        expect(out.find(e => e.id === 'a')!.category).toBe('Home')
        expect(out.find(e => e.id === 'b')!.title).toBe('edited')
    })

    test(`${format}: app delete stays deleted, external delete not resurrected`, async () => {
        disk = file([ev('a'), ev('b'), ev('c')], format)
        const b = new BaseBackend('x', io)
        await b.init()
        disk = file([ev('a'), ev('b')], format) // c deleted externally
        const d = b.load()!
        d.events = d.events.filter(e => e.id !== 'a') // app deletes a
        b.save(d)
        await b.reloadIfChanged()
        expect(ids()).toEqual(['b'])
    })

    test(`${format}: unchanged echo does not trigger reload; writes stay ordered`, async () => {
        disk = file([ev('a')], format)
        const b = new BaseBackend('x', io)
        await b.init()
        const d = b.load()!
        d.events = [...d.events, ev('n1')]
        b.save(d)
        d.events = [...d.events, ev('n2')]
        b.save(d)
        expect(await b.reloadIfChanged()).toBe(false)
        expect(ids()).toEqual(['a', 'n1', 'n2'])
    })
}

test('app category change wins; external category list kept otherwise', async () => {
    const f = { ...fm, categories: [{ name: 'Work', color: '#111111' }] }
    disk = file([ev('a')], 'jsonl', f)
    const b = new BaseBackend('x', io)
    await b.init()
    disk = file([ev('a')], 'jsonl', {
        ...fm,
        categories: [{ name: 'Home', color: '#222222' }],
    })
    const d = b.load()!
    d.events[0] = { ...d.events[0], title: 'edited' }
    b.save(d)
    await b.reloadIfChanged()
    expect(parseCalendarFile(disk).frontmatter.categories).toEqual([
        { name: 'Home', color: '#222222' },
    ])
})

test('a jsonl calendar with an unparseable line is never rewritten', async () => {
    const bad = file([ev('a')], 'jsonl') + 'not json\n'
    disk = bad
    const b = new BaseBackend('x', io)
    await b.init()
    expect(b.parseError).not.toBeNull()
    b.save({ events: [ev('z')] as any, categories: [] })
    await b.reloadIfChanged()
    expect(disk).toBe(bad)
    expect(writes.length).toBe(0)
})

test('line gone bad after load blocks the write too', async () => {
    disk = file([ev('a')], 'jsonl')
    const b = new BaseBackend('x', io)
    await b.init()
    const bad = disk + 'oops\n'
    disk = bad
    const d = b.load()!
    d.events[0] = { ...d.events[0], title: 'edited' }
    b.save(d)
    await b.reloadIfChanged()
    expect(disk).toBe(bad)
    expect(b.parseError).not.toBeNull()
})

test('a calendar moved after load refuses the write instead of recreating it', async () => {
    disk = file([ev('a')], 'jsonl')
    const b = new BaseBackend('x.base.jsonl', io)
    await b.init()
    disk = null
    const d = b.load()!
    d.events[0] = { ...d.events[0], title: 'edited' }
    b.save(d)
    await b.reloadIfChanged()
    expect(writes.length).toBe(0)
    expect(disk).toBeNull()
    expect(b.parseError?.message).toContain('moved or deleted')
})

test('a missing jsonl calendar starts as jsonl', async () => {
    const b = new BaseBackend('X.base.jsonl', io)
    await b.init()
    b.save({ events: [ev('n')] as any, categories: [] })
    await b.reloadIfChanged()
    expect(disk!.trimStart().startsWith('{')).toBe(true)
})

test('a refusal toasts once across queued saves, and again after a good write', async () => {
    toasts().forEach(t => dismissToast(t.id))
    const refusals = () =>
        toasts().filter(t => t.message.startsWith('Calendar not saved')).length
    disk = file([ev('a')], 'jsonl')
    const b = new BaseBackend('x', io)
    await b.init()
    const d = b.load()!
    const saveThrice = async () => {
        for (let i = 0; i < 3; i++)
            b.save({ events: [...d.events], categories: [] } as any)
        await b.reloadIfChanged()
    }
    const saved = disk
    disk = null
    await saveThrice()
    expect(refusals()).toBe(1)
    disk = saved
    await saveThrice() // succeeds, clears the remembered refusal
    expect(b.parseError).toBeNull()
    disk = null
    await saveThrice()
    expect(refusals()).toBe(2)
})

// A save that lands while reloadIfChanged() is mid-read must not be undone by that read.
for (const order of ['r1-first', 'r2-first'] as const) {
    test(`save during a reload read keeps the edit and the external add (${order})`, async () => {
        const fmt = 'jsonl'
        let state = file([ev('a')], fmt)
        const pending: { resolve: (t: string) => void }[] = []
        const gated = {
            read: (_p: string) => {
                if (!gate) return Promise.resolve(state)
                return new Promise<string>(resolve => {
                    pending.push({ resolve })
                })
            },
            write: async (_p: string, t: string) => {
                state = t
            },
        }
        let gate = false
        const b = new BaseBackend('x', gated)
        await b.init()
        state = file([ev('a'), ev('x')], fmt) // external sync adds x
        gate = true
        const p = b.reloadIfChanged()
        const until = async (n: number) => {
            for (let i = 0; i < 50 && pending.length < n; i++)
                await new Promise(r => setTimeout(r, 0))
        }
        await until(1)
        const d = b.load()!
        d.events[0] = { ...d.events[0], title: 'edited' }
        b.save(d)
        await until(2)
        const seen = state
        const [r1, r2] = pending.splice(0, 2)
        if (order === 'r1-first') {
            r1.resolve(seen)
            r2.resolve(seen)
        } else {
            r2.resolve(seen)
            r1.resolve(seen)
        }
        gate = false
        // any further (re-)reads are served live
        for (const q of pending.splice(0)) q.resolve(state)
        await p
        await new Promise(r => setTimeout(r, 0))
        const out = parseCalendarFile(state)
        expect(out.events.map(e => e.id).sort()).toEqual(['a', 'x'])
        expect(out.events.find(e => e.id === 'a')!.title).toBe('edited')
        expect(b.load()!.events.find(e => e.id === 'a')!.title).toBe('edited')
        // a later unrelated edit keeps the first one
        const d2 = b.load()!
        d2.events = d2.events.map(e =>
            e.id === 'x' ? { ...e, title: 'x2' } : e,
        )
        b.save(d2)
        await b.reloadIfChanged()
        const out2 = parseCalendarFile(state)
        expect(out2.events.find(e => e.id === 'a')!.title).toBe('edited')
        expect(out2.events.find(e => e.id === 'x')!.title).toBe('x2')
    })
}
