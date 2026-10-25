import { test, expect } from 'bun:test'
import { dropsToFit, type BarFitGroup } from './barFit'

const groups: BarFitGroup[] = [
    { level: 4, width: 80 },
    { level: 3, width: 60 },
    { level: 2, width: 100 },
    { level: 1, width: 40 },
]
// total 280
const base = { fixed: 100, groups, trigger: 30 }

test('everything fits: nothing hides and the trigger is not charged', () => {
    expect(dropsToFit({ ...base, available: 380 }).hiddenLevels).toEqual([])
    expect(dropsToFit({ ...base, available: 500 }).hiddenLevels).toEqual([])
})

test('one pixel short hides level 4 only', () => {
    // 100 + 30 + 200 = 330
    expect(dropsToFit({ ...base, available: 379 }).hiddenLevels).toEqual([4])
    expect(dropsToFit({ ...base, available: 330 }).hiddenLevels).toEqual([4])
})

test('levels drop cumulatively in the order 4, 3, 2, 1', () => {
    // after 4 and 3: 100 + 30 + 140 = 270
    expect(dropsToFit({ ...base, available: 329 }).hiddenLevels).toEqual([4, 3])
    expect(dropsToFit({ ...base, available: 270 }).hiddenLevels).toEqual([4, 3])
    // after 4, 3, 2: 100 + 30 + 40 = 170
    expect(dropsToFit({ ...base, available: 269 }).hiddenLevels).toEqual([4, 3, 2])
    expect(dropsToFit({ ...base, available: 170 }).hiddenLevels).toEqual([4, 3, 2])
    // after all: 100 + 30 = 130
    expect(dropsToFit({ ...base, available: 169 }).hiddenLevels).toEqual([4, 3, 2, 1])
    expect(dropsToFit({ ...base, available: 130 }).hiddenLevels).toEqual([4, 3, 2, 1])
})

test('the trigger is charged only when something hides', () => {
    // fixed + total = 380 fits at 380 with no trigger; hiding level 4 needs the trigger's 30 too.
    expect(dropsToFit({ ...base, available: 380 }).hiddenLevels).toEqual([])
    // 340 would fit the remaining 200 + fixed 100 = 300 + trigger 30 = 330 <= 340
    expect(dropsToFit({ ...base, available: 340 }).hiddenLevels).toEqual([4])
    // a trigger wider than the freed space pushes the drop one level deeper
    expect(
        dropsToFit({ ...base, trigger: 90, available: 375 }).hiddenLevels,
    ).toEqual([4, 3])
})

test('floor: when even all four hidden does not fit, all four are returned', () => {
    expect(dropsToFit({ ...base, available: 50 }).hiddenLevels).toEqual([4, 3, 2, 1])
    expect(dropsToFit({ ...base, available: 0 }).hiddenLevels).toEqual([4, 3, 2, 1])
})

test('several elements sharing a level drop together', () => {
    const shared: BarFitGroup[] = [
        { level: 4, width: 50 },
        { level: 4, width: 50 },
        { level: 3, width: 50 },
    ]
    const input = { fixed: 100, groups: shared, trigger: 20 }
    // total 150 -> 250; hiding level 4 frees 100: 100 + 20 + 50 = 170
    expect(dropsToFit({ ...input, available: 249 }).hiddenLevels).toEqual([4])
    expect(dropsToFit({ ...input, available: 170 }).hiddenLevels).toEqual([4])
})

test('no groups: nothing to hide whether it fits or not, never a crash', () => {
    expect(dropsToFit({ available: 100, fixed: 50, groups: [], trigger: 30 }).hiddenLevels).toEqual([])
    expect(dropsToFit({ available: 10, fixed: 50, groups: [], trigger: 30 }).hiddenLevels).toEqual([])
})

test('net saving: a level no wider than the trigger is not hidden for it', () => {
    // 24 freed, 30 charged: hiding would swap a control for a wider [≡]
    const one = { fixed: 100, groups: [{ level: 4 as const, width: 24 }], trigger: 30 }
    expect(dropsToFit({ ...one, available: 110 }).hiddenLevels).toEqual([])
    expect(dropsToFit({ ...one, available: 0 }).hiddenLevels).toEqual([])
    // exactly equal is still no gain
    const equal = { fixed: 100, groups: [{ level: 4 as const, width: 30 }], trigger: 30 }
    expect(dropsToFit({ ...equal, available: 110 }).hiddenLevels).toEqual([])
    // one pixel wider than the trigger is a gain and hides
    const wider = { fixed: 100, groups: [{ level: 4 as const, width: 31 }], trigger: 30 }
    expect(dropsToFit({ ...wider, available: 130 }).hiddenLevels).toEqual([4])
})

test('net saving is judged on the cumulative set: small levels add up to a gain', () => {
    const small = {
        fixed: 100,
        groups: [
            { level: 4 as const, width: 20 },
            { level: 3 as const, width: 20 },
        ],
        trigger: 30,
    }
    // level 4 alone frees 20 (< 30); 4 and 3 free 40 (> 30) and fit at 100 + 30 = 130
    expect(dropsToFit({ ...small, available: 130 }).hiddenLevels).toEqual([4, 3])
})

test('no oscillation at the threshold: the result is a pure function of the width', () => {
    // Sweep the width up, down and up again across every threshold: each width always maps to the
    // same result because widths are natural (measured shown), so a boundary cannot flip-flop.
    const seen = new Map<number, string>()
    const sweep = [...Array(41).keys()].map(i => 100 + i * 10)
    for (const w of [...sweep, ...[...sweep].reverse(), ...sweep]) {
        const r = JSON.stringify(dropsToFit({ ...base, available: w }).hiddenLevels)
        if (seen.has(w)) expect(r).toBe(seen.get(w)!)
        seen.set(w, r)
    }
    // monotone: a wider bar never hides more than a narrower one
    let prev = 5
    for (const w of sweep) {
        const n = dropsToFit({ ...base, available: w }).hiddenLevels.length
        expect(n).toBeLessThanOrEqual(prev)
        prev = n
    }
})
