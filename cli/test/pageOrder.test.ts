import { expect, test } from 'bun:test'
import { parsePageOrder } from '../src/pageOrder'

test('pages, ranges, blank and sources', () => {
    expect(parsePageOrder('1,3,2,blank,@scans/a.png')).toEqual({
        order: [{ page: 1 }, { page: 3 }, { page: 2 }, { blank: true }, { file: 'scans/a.png' }],
    })
    expect(parsePageOrder('2-4')).toEqual({ order: [{ page: 2 }, { page: 3 }, { page: 4 }] })
    expect(parsePageOrder('4-2')).toEqual({ order: [{ page: 4 }, { page: 3 }, { page: 2 }] })
    expect(parsePageOrder('@./o.pdf,@o.pdf#4,@o.pdf#2-3')).toEqual({
        order: [{ file: 'o.pdf' }, { file: 'o.pdf', page: 4 }, { file: 'o.pdf', page: 2 }, { file: 'o.pdf', page: 3 }],
    })
})

test('bad items say which one', () => {
    for (const bad of ['', '1,,2', '0', 'x', '@', '@a.png#2', '@a.pdf#x', '1-0']) {
        expect(parsePageOrder(bad)).toHaveProperty('error')
    }
    expect((parsePageOrder('1,zebra') as { error: string }).error).toContain('zebra')
})
