// core/test/pdfMergePlan.test.ts — planMerge: the same pages lined up in order (kept, or updated when
// written on), the rest paired by position, new pages where the newer version has them, old-only
// pages kept; pageMatch's likeness and added ink.
import { describe, expect, test } from 'bun:test'
import { ADDED_MIN, INK_H, INK_W, pageMatch, planMerge, SAME_MIN, type MergeStep, type PageMatch } from '../src/pdfMergePlan'

/** Pages named by letters: the same letter is the same page, `A'` is A written on. */
function matrix(old: string[], next: string[]): PageMatch[][] {
    return old.map(o =>
        next.map(n =>
            o === n
                ? { same: 0.95, added: 0.01 }
                : n.replace(/'+$/, '') === o.replace(/'+$/, '')
                  ? { same: 0.8, added: 0.3 }
                  : { same: 0.1, added: 0.5 },
        ),
    )
}
const show = (steps: MergeStep[]) =>
    steps.map(s =>
        s.kind === 'keep' ? `=${s.page}` : s.kind === 'update' ? `${s.page}>${s.from}` : s.kind === 'add' ? `+${s.from}` : `~${s.page}`,
    )
const plan = (old: string[], next: string[]) => show(planMerge(matrix(old, next), next.length))

describe('planMerge', () => {
    test('pages appended at the end are added, the rest kept', () => {
        expect(plan(['A', 'B', 'C'], ['A', 'B', 'C', 'D', 'E'])).toEqual(['=0', '=1', '=2', '+3', '+4'])
    })

    test('the last page written on and a page appended: it is updated, the other added', () => {
        expect(plan(['A', 'B', 'C'], ['A', 'B', "C'", 'D'])).toEqual(['=0', '=1', '2>2', '+3'])
    })

    test('pages added before and after, one page written on', () => {
        expect(plan(['A', 'B', 'C', 'D'], ['X', 'Y', 'A', 'B', "C'", 'D', 'Z'])).toEqual(['+0', '+1', '=0', '=1', '2>4', '=3', '+6'])
    })

    test('a page in the middle that no longer matches is updated in place', () => {
        const m = matrix(['A', 'B', 'C'], ['A', 'X', 'C'])
        expect(show(planMerge(m, 3))).toEqual(['=0', '1>1', '=2'])
    })

    test('a page inserted in the middle is added there', () => {
        expect(plan(['A', 'B', 'C'], ['A', 'X', 'B', 'C'])).toEqual(['=0', '+1', '=1', '=2'])
    })

    test('a page the newer version lacks stays after the page it followed', () => {
        expect(plan(['A', 'B', 'C', 'D'], ['A', 'C', 'D'])).toEqual(['=0', '~1', '=2', '=3'])
        expect(plan(['A', 'B', 'C'], ['B', 'C'])).toEqual(['~0', '=1', '=2'])
    })

    test('a page that moved takes its old page at the new place', () => {
        expect(plan(['A', 'B', 'C', 'D'], ['A', 'C', 'D', 'B'])).toEqual(['=0', '=2', '=3', '=1'])
    })

    test('a sparse page that looks like a later page does not pull the order apart', () => {
        // old page 2 (C) also looks like the newer page Z at the end, more than like its own rescan
        const m = matrix(['A', 'B', 'C', 'D', 'E'], ['A', 'B', "C'", 'D', 'E', 'Z'])
        m[2]![5] = { same: 0.9, added: 0.05 }
        m[2]![2] = { same: 0.5, added: 0.3 }
        expect(show(planMerge(m, 6))).toEqual(['=0', '=1', '2>2', '=3', '=4', '+5'])
    })

    test('pages before the first match pair counting back from it', () => {
        // the newer copy starts at old page 2, which was written over past matching since
        expect(plan(['A', 'B', 'C', 'D', 'E'], ['X', 'D', 'E', 'F'])).toEqual(['~0', '~1', '2>0', '=3', '=4', '+3'])
        expect(plan(['A', 'B', 'C'], ['X', 'Y', 'C'])).toEqual(['0>0', '1>1', '=2'])
    })

    test('nothing in common pairs every page by order', () => {
        expect(plan(['A', 'B'], ['X', 'Y', 'Z'])).toEqual(['0>0', '1>1', '+2'])
        expect(plan(['A', 'B', 'C'], ['X'])).toEqual(['0>0', '~1', '~2'])
    })

    test('every old page is used once, every new page appears once, in order', () => {
        const steps = planMerge(matrix(['A', 'B', 'C', 'D'], ['D', 'X', "B'", 'A', 'Y']), 5)
        const olds = steps.flatMap(s => (s.kind === 'add' ? [] : [s.page]))
        expect(new Set(olds).size).toBe(olds.length)
        expect(olds.sort()).toEqual([0, 1, 2, 3])
        expect(steps.flatMap(s => (s.kind === 'only' ? [] : [s.from]))).toEqual([0, 1, 2, 3, 4])
    })
})

describe('pageMatch', () => {
    /** A page of handwriting: lines of ink, `rows` of them, each a little different in length. */
    const page = (rows: number[], shift = 0) => {
        const g = new Float32Array(INK_W * INK_H)
        for (const r of rows)
            for (let x = 3; x < 3 + 20 + ((r * 7) % 14); x++) {
                const y = r + shift
                if (y >= 0 && y < INK_H) g[y * INK_W + x] = 0.4
            }
        return g
    }
    const rows = [5, 9, 13, 17, 21, 25, 29]

    test('the same page framed two cells lower is alike and has nothing added', () => {
        const m = pageMatch(page(rows), page(rows, 2))
        expect(m.same).toBeGreaterThan(SAME_MIN)
        expect(m.added).toBeLessThan(ADDED_MIN)
    })

    test('the same page with a line written under it has ink added', () => {
        const m = pageMatch(page(rows), page([...rows, 35]))
        expect(m.same).toBeGreaterThan(SAME_MIN)
        expect(m.added).toBeGreaterThanOrEqual(ADDED_MIN)
    })

    test('another page is not alike', () => {
        expect(pageMatch(page(rows), page([40, 44, 48, 52])).same).toBeLessThan(SAME_MIN)
    })

    test('two blank pages are alike, a blank and a written page are not', () => {
        expect(pageMatch(page([]), page([])).same).toBe(1)
        expect(pageMatch(page([]), page(rows)).same).toBe(0)
    })
})
