// app/src/preview/pdfOutline.test.ts
import { describe, expect, test } from 'bun:test'
import {
    resolveOutline,
    type OutlineSource,
    type RawOutlineItem,
} from './pdfOutline'

/** A fake pdf.js document: page refs are `{ num }` objects, resolved by `refs`; named dests by
 *  `named`. Anything unknown rejects, the way pdf.js does for a bad ref. */
function source(
    outline: RawOutlineItem[] | null,
    opts: {
        named?: Record<string, unknown[] | null>
        refs?: Map<unknown, number>
        outlineThrows?: boolean
    } = {},
): OutlineSource {
    return {
        getOutline: async () => {
            if (opts.outlineThrows) throw new Error('bad outline')
            return outline
        },
        getDestination: async id => {
            if (!(id in (opts.named ?? {}))) throw new Error(`no dest ${id}`)
            return opts.named![id]!
        },
        getPageIndex: async ref => {
            const i = opts.refs?.get(ref)
            if (i === undefined) throw new Error('bad ref')
            return i
        },
    }
}

const item = (
    title: string,
    dest: RawOutlineItem['dest'],
    items: RawOutlineItem[] = [],
): RawOutlineItem => ({ title, dest, items })

describe('resolveOutline', () => {
    test('no outline → []', async () => {
        expect(await resolveOutline(source(null))).toEqual([])
        expect(await resolveOutline(source([]))).toEqual([])
    })

    test('array dest with a page ref resolves through getPageIndex', async () => {
        const ref = { num: 7, gen: 0 }
        const got = await resolveOutline(
            source([item('Intro', [ref, { name: 'XYZ' }, 0, 0, 0])], {
                refs: new Map([[ref, 3]]),
            }),
        )
        expect(got).toEqual([{ title: 'Intro', page: 3, children: [] }])
    })

    test('a number dest[0] is already a page index', async () => {
        const got = await resolveOutline(
            source([item('Two', [1, { name: 'Fit' }])]),
        )
        expect(got).toEqual([{ title: 'Two', page: 1, children: [] }])
    })

    test('a string dest resolves via getDestination first', async () => {
        const ref = { num: 9 }
        const got = await resolveOutline(
            source([item('Named', 'chap2')], {
                named: { chap2: [ref, { name: 'XYZ' }] },
                refs: new Map([[ref, 5]]),
            }),
        )
        expect(got).toEqual([{ title: 'Named', page: 5, children: [] }])
    })

    test('nested items keep their shape and resolve independently', async () => {
        const a = { num: 1 }
        const b = { num: 2 }
        const got = await resolveOutline(
            source(
                [
                    item('Part', [a], [item('Sub', [b]), item('Leaf', [0])]),
                    item('Tail', [2]),
                ],
                {
                    refs: new Map([
                        [a, 0],
                        [b, 4],
                    ]),
                },
            ),
        )
        expect(got).toEqual([
            {
                title: 'Part',
                page: 0,
                children: [
                    { title: 'Sub', page: 4, children: [] },
                    { title: 'Leaf', page: 0, children: [] },
                ],
            },
            { title: 'Tail', page: 2, children: [] },
        ])
    })

    test('every kind of failure is page: null, never a throw', async () => {
        const got = await resolveOutline(
            source(
                [
                    item('Null dest', null),
                    item('Unknown name', 'missing'),
                    item('Name resolves to null', 'nulled'),
                    item('Bad ref', [{ num: 404 }]),
                    item('Empty array', []),
                    item('Negative index', [-1]),
                ],
                { named: { nulled: null } },
            ),
        )
        expect(got.map(n => n.page)).toEqual([
            null,
            null,
            null,
            null,
            null,
            null,
        ])
        expect(got.map(n => n.title)).toEqual([
            'Null dest',
            'Unknown name',
            'Name resolves to null',
            'Bad ref',
            'Empty array',
            'Negative index',
        ])
    })

    test('getOutline itself failing → []', async () => {
        expect(
            await resolveOutline(source(null, { outlineThrows: true })),
        ).toEqual([])
    })
})
