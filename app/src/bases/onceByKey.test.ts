import { expect, test } from 'bun:test'
import { onceByKey } from './onceByKey'

test('callers asking at once share one load, one per key', async () => {
    const loads: string[] = []
    const get = onceByKey(
        (k: string) => k,
        async k => {
            loads.push(k)
            return k.toUpperCase()
        },
    )
    const got = await Promise.all([get('a'), get('a'), get('a'), get('b')])
    expect(got).toEqual(['A', 'A', 'A', 'B'])
    expect(loads).toEqual(['a', 'b'])
})

test('a finished value is kept', async () => {
    let loads = 0
    const get = onceByKey(
        (k: string) => k,
        async () => ++loads,
    )
    await get('a')
    expect(await get('a')).toBe(1)
})

test('a failed load rejects everyone waiting and the next call tries again', async () => {
    let loads = 0
    const get = onceByKey(
        (k: string) => k,
        async () => {
            if (++loads === 1) throw new Error('no')
            return 'ok'
        },
    )
    const first = await Promise.allSettled([get('a'), get('a')])
    expect(first.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(loads).toBe(1)
    expect(await get('a')).toBe('ok')
})
