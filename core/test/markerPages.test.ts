import { describe, expect, test } from 'bun:test'
import { markerArgs, pageRanges, splitMarkerPages } from '../src/marker'

const DASHES = '-'.repeat(48)

describe('splitMarkerPages', () => {
    test('labels are 0-based page ids, so a run over pages 2-3 comes back as pages 2 and 3', () => {
        // The shape marker_single --paginate_output --page_range 1-2 wrote for a lecture notebook.
        const md = `\n\n{1}${DASHES}\n\nClaim\n\n$$\\lim_{n \\rightarrow \\infty} \\frac{1}{n^2} = 0$$\n\nLet  $\\epsilon > 0$ \n\n{2}${DASHES}\n\nClaim\n\n$\\lim s_n = 4$\n`
        expect(splitMarkerPages(md)).toEqual([
            { page: 2, text: 'Claim\n\n$$\\lim_{n \\rightarrow \\infty} \\frac{1}{n^2} = 0$$\n\nLet $\\epsilon > 0$' },
            { page: 3, text: 'Claim\n\n$\\lim s_n = 4$' },
        ])
    })

    test('unlabelled markdown, an image, is page 1', () => {
        expect(splitMarkerPages('Dear  diary\n')).toEqual([{ page: 1, text: 'Dear diary' }])
    })

    test('a page marker read as nothing keeps its place with empty text', () => {
        expect(splitMarkerPages(`{0}${DASHES}\n\n{1}${DASHES}\nhi\n`)).toEqual([
            { page: 1, text: '' },
            { page: 2, text: 'hi' },
        ])
    })
})

describe('pageRanges', () => {
    test('runs of pages collapse to ranges, sorted and deduplicated', () => {
        expect(pageRanges([7, 1, 2, 3, 3])).toEqual([[1, 3], [7, 7]])
        expect(pageRanges([])).toEqual([])
    })
})

describe('markerArgs', () => {
    test('paginate asks Marker to label each page', () => {
        expect(markerArgs('/v/n.pdf', '/o', { paginate: true, pages: [[2, 3]] })).toEqual([
            '/v/n.pdf', '--output_dir', '/o', '--output_format', 'markdown', '--disable_image_extraction',
            '--strip_existing_ocr', '--paginate_output', '--page_range', '1-2',
        ])
    })
})
