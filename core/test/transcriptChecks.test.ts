import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiChecks, emptyPageChecks, onDeviceChecks, onDeviceLevel, wordsOf } from '../src/transcriptChecks'
import {
    approveCheck,
    checkKey,
    liveChecks,
    mergeTranscript,
    readTranscript,
    remapTranscriptPages,
    setTranscriptPage,
    stripTranscriptMarkers,
} from '../src/transcript'
import { addMarks } from '../src/bookMarks'
import { approveTranscriptCheck, readStoredTranscript, setTranscribeEngines, transcribe, type TranscriptionSettings } from '../src/transcribe'
import { tempDir } from './tempDirs'

const settings: TranscriptionSettings = { auto: true, engine: 'auto', math: 'fast', provider: 'auto', model: '' }

afterEach(() => setTranscribeEngines(null))

// ---- the fitted on-device rule ----

test('a line at or below the confidence cut is garbled, whatever its spelling', () => {
    expect(onDeviceLevel({ text: 'the quick brown fox jumps', confidence: 0.5, misspelled: 0 })).toBe('garbled')
    expect(onDeviceLevel({ text: 'the quick brown fox jumps', confidence: 0.3 })).toBe('garbled')
})

test('a confident line is garbled by many or a large share of misspelled words, unsure by one', () => {
    expect(onDeviceLevel({ text: 'a b c d e f g h i j k', confidence: 1, misspelled: 3 })).toBe('garbled')
    expect(onDeviceLevel({ text: 'How can I be optimistie', confidence: 1, misspelled: 1 })).toBe('garbled')
    expect(onDeviceLevel({ text: 'How can I be optimistie about the will', confidence: 1, misspelled: 1 })).toBe('unsure')
    expect(onDeviceLevel({ text: 'How can I be optimistic about the will', confidence: 1, misspelled: 0 })).toBeUndefined()
})

test('a line with no words is never flagged', () => {
    expect(onDeviceLevel({ text: '— · —', confidence: 0.3, misspelled: 0 })).toBeUndefined()
    expect(wordsOf("it's ﬁne, 3.5x")).toEqual(['its', 'fine', '3', '5x'])
})

test('onDeviceChecks keys each flagged line by its trimmed text, in order', () => {
    expect(
        onDeviceChecks([
            { text: 'fine words here', confidence: 1, misspelled: 0 },
            { text: '  zzq qqx  ', confidence: 1, misspelled: 2 },
            { text: 'low one', confidence: 0.3 },
        ]),
    ).toEqual([
        { line: 'zzq qqx', level: 'garbled' },
        { line: 'low one', level: 'garbled' },
    ])
})

test('ai guess marks become unsure checks and leave the text; a lone [?] is garbled and stays', () => {
    const r = aiChecks('Dear diary[?] today\nwe went to the [?] market\nall clear')
    expect(r.text).toBe('Dear diary today\nwe went to the [?] market\nall clear')
    expect(r.checks).toEqual([
        { line: 'Dear diary today', level: 'unsure' },
        { line: 'we went to the [?] market', level: 'garbled' },
    ])
})

test('the math reader page is flagged whole only when it is empty and the page had lines', () => {
    expect(emptyPageChecks('', 4)).toEqual([{ line: '', level: 'garbled' }])
    expect(emptyPageChecks('   ', 0)).toEqual([])
    expect(emptyPageChecks('$x$', 4)).toEqual([])
})

// ---- storage in the transcript block ----

const pages = [
    { page: 1, text: 'first line\nbad lyne here', checks: [{ line: 'bad lyne here', level: 'unsure' as const }] },
    { page: 2, text: '', checks: [{ line: '', level: 'garbled' as const }] },
    { page: 3, text: 'plain' },
]

test('checks round-trip through the block and no page text holds the checks line', () => {
    const md = mergeTranscript('', pages, 'on-device', 'pdf')
    expect(md).toContain('<!-- bismuth:transcript:checks ')
    const back = readTranscript(md)
    expect(back.map(p => p.text)).toEqual(['first line\nbad lyne here', '', 'plain'])
    expect(back[0].checks).toEqual([{ line: 'bad lyne here', level: 'unsure' }])
    expect(back[1].checks).toEqual([{ line: '', level: 'garbled' }])
    expect(back[2].checks).toBeUndefined()
    expect(stripTranscriptMarkers(md)).not.toContain('checks')
})

test('an image transcript keeps its checks out of the page text', () => {
    const md = mergeTranscript('', [{ page: 1, text: 'one\ntwo', checks: [{ line: 'two', level: 'garbled' }] }], 'ai', 'image')
    expect(readTranscript(md)).toEqual([{ page: 1, text: 'one\ntwo', checks: [{ line: 'two', level: 'garbled' }] }])
    const marked = addMarks(md, 1, ['two'])
    expect(readTranscript(marked)[0]).toEqual({ page: 1, text: 'one\n==two==', checks: [{ line: 'two', level: 'garbled' }] })
})

test('a quote holding --> cannot end the checks comment early', () => {
    const md = mergeTranscript('', [{ page: 1, text: 'a --> b', checks: [{ line: 'a --> b', level: 'unsure' }] }], 'ai', 'image')
    expect(readTranscript(md)[0].checks).toEqual([{ line: 'a --> b', level: 'unsure' }])
})

test('retyping a flagged line clears its check; marks and spacing do not', () => {
    const md = mergeTranscript('', pages, 'on-device', 'pdf')
    expect(readTranscript(setTranscriptPage(md, 1, 'first line\nbad line here', 'pdf'))[0].checks).toBeUndefined()
    expect(readTranscript(setTranscriptPage(md, 1, 'first ==line==\n  ==bad lyne== here ', 'pdf'))[0].checks).toEqual([
        { line: 'bad lyne here', level: 'unsure' },
    ])
    // text typed into a page flagged whole clears it
    expect(readTranscript(setTranscriptPage(md, 2, 'typed by hand', 'pdf'))[1].checks).toBeUndefined()
    expect(checkKey('  ==a==   b ')).toBe('a b')
    expect(liveChecks('x', [{ line: '', level: 'garbled' }])).toEqual([])
})

test('approving clears one check and leaves the text byte for byte', () => {
    const md = mergeTranscript('', pages, 'on-device', 'pdf')
    const next = approveCheck(md, 1, 'bad lyne here', 'pdf')
    expect(readTranscript(next)[0]).toEqual({ page: 1, text: 'first line\nbad lyne here' })
    expect(readTranscript(next)[1].checks).toEqual([{ line: '', level: 'garbled' }])
    expect(approveCheck(md, 3, 'plain', 'pdf')).toBe(md)
    const none = approveCheck(next, 2, '', 'pdf')
    expect(none).not.toContain('bismuth:transcript:checks')
})

test('checks follow their page when a pdf is rewritten', () => {
    const md = mergeTranscript('', pages, 'on-device', 'pdf')
    const moved = readTranscript(remapTranscriptPages(md, [2, 0]))
    expect(moved).toEqual([
        { page: 1, text: 'plain' },
        { page: 2, text: 'first line\nbad lyne here', checks: [{ line: 'bad lyne here', level: 'unsure' }] },
    ])
})

// ---- the transcribe pipeline stores them ----

test('an on-device run stores a check for each line the rule flags', async () => {
    const root = tempDir('bismuth-checks-')
    writeFileSync(join(root, 'scan.png'), 'x')
    setTranscribeEngines({
        onDevice: async () => [
            {
                page: 1,
                text: 'clean line of words\nGramsor wrote this',
                confidence: 0.9,
                lines: [
                    { text: 'clean line of words', confidence: 1, misspelled: 0 },
                    { text: 'Gramsor wrote this', confidence: 1, misspelled: 1 },
                ],
            },
        ],
    })
    await transcribe(root, { file: 'scan.png', engine: 'on-device' }, { settings })
    const stored = await readStoredTranscript(root, 'scan.png')
    expect(stored.pages[0].checks).toEqual([{ line: 'Gramsor wrote this', level: 'garbled' }])
    const r = await approveTranscriptCheck(root, { file: 'scan.png', page: 1, line: 'Gramsor wrote this' })
    expect(r.checks).toEqual([])
    expect(readFileSync(join(root, 'scan.png.md'), 'utf8')).not.toContain('transcript:checks')
})

test('a paged run flags a math page the math reader returned empty', async () => {
    const root = tempDir('bismuth-checks-')
    writeFileSync(join(root, 'math.png'), 'x')
    setTranscribeEngines({
        onDevice: async () => [
            {
                page: 1,
                text: 'x = y + 2\nf(x) = 3x',
                confidence: 1,
                lines: [
                    { text: 'x = y + 2', confidence: 1, misspelled: 0 },
                    { text: 'f(x) = 3x', confidence: 1, misspelled: 0 },
                ],
            },
        ],
        marker: async () => [{ page: 1, text: '' }],
    })
    await transcribe(root, { file: 'math.png', engine: 'auto', math: 'careful' }, { settings, onPage: () => {} })
    const stored = await readStoredTranscript(root, 'math.png')
    expect(stored.pages).toEqual([{ page: 1, text: '', checks: [{ line: '', level: 'garbled' }] }])
})

test('placeChecks puts each check on the first free line with its text', async () => {
    const { placeChecks } = await import('../src/transcriptChecks')
    const lines = ['same', 'other', '==same==', 'x']
    expect(
        placeChecks(lines, [
            { line: 'same', level: 'unsure' },
            { line: 'same', level: 'garbled' },
            { line: 'gone', level: 'unsure' },
            { line: '', level: 'garbled' },
        ]),
    ).toEqual([
        { index: 0, check: { line: 'same', level: 'unsure' } },
        { index: 2, check: { line: 'same', level: 'garbled' } },
    ])
})
