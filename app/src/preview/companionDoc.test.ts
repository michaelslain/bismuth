// app/src/preview/companionDoc.test.ts
import { describe, expect, test } from 'bun:test'
import {
    EMPTY_FRONTMATTER,
    joinCompanion,
    shouldWriteCompanionDoc,
    splitCompanion,
} from './companionDoc'
import type { ScratchBlock } from '../../../core/src/scratchTypes'

const block = (text: string): ScratchBlock => ({
    id: 'aaaa',
    page: 0,
    x: 0,
    y: 0,
    w: 100,
    text,
})

describe('splitCompanion', () => {
    test('no frontmatter — the whole text is body', () => {
        expect(splitCompanion('just some notes\nabout this photo\n')).toEqual({
            frontmatter: '',
            body: 'just some notes\nabout this photo\n',
        })
    })
    test('empty text — no frontmatter, empty body', () => {
        expect(splitCompanion('')).toEqual({ frontmatter: '', body: '' })
    })
    test('frontmatter + body — the fence block and everything after it split cleanly', () => {
        const text = '---\ntags: [trip, 2026]\n---\nA note about the trip.\n'
        expect(splitCompanion(text)).toEqual({
            frontmatter: '---\ntags: [trip, 2026]\n---\n',
            body: 'A note about the trip.\n',
        })
    })
    test('frontmatter-only file — no trailing body text at all', () => {
        const text = '---\ntags: [a]\n---\n'
        expect(splitCompanion(text)).toEqual({
            frontmatter: '---\ntags: [a]\n---\n',
            body: '',
        })
    })
    test('CRLF line endings are matched the same as LF', () => {
        const text = '---\r\ntags: [a, b]\r\n---\r\nbody line\r\n'
        expect(splitCompanion(text)).toEqual({
            frontmatter: '---\r\ntags: [a, b]\r\n---\r\n',
            body: 'body line\r\n',
        })
    })
    test('extra --- fences inside the body do not confuse the split (stops at the FIRST closer)', () => {
        const text = '---\ntags: [a]\n---\nbody\n---\nmore body\n'
        expect(splitCompanion(text)).toEqual({
            frontmatter: '---\ntags: [a]\n---\n',
            body: 'body\n---\nmore body\n',
        })
    })
})

describe('joinCompanion', () => {
    test('recombines frontmatter + body verbatim', () => {
        expect(joinCompanion('---\ntags: [a]\n---\n', 'body text\n')).toBe(
            '---\ntags: [a]\n---\nbody text\n',
        )
    })
    test('body preserved on a frontmatter edit — only the fenced block changes', () => {
        const original = '---\ntags: [trip]\n---\nA note about the trip.\n'
        const { body } = splitCompanion(original)
        const edited = joinCompanion('---\ntags: [trip, 2026]\n---\n', body)
        expect(edited).toBe(
            '---\ntags: [trip, 2026]\n---\nA note about the trip.\n',
        )
    })
    test('empty frontmatter + body round-trips to plain body text', () => {
        expect(joinCompanion('', 'just text\n')).toBe('just text\n')
    })
})

describe('shouldWriteCompanionDoc', () => {
    test('no companion exists yet + still the untouched EMPTY_FRONTMATTER template + no blocks -> no write', () => {
        expect(shouldWriteCompanionDoc('', EMPTY_FRONTMATTER, [])).toBe(false)
    })
    test('no companion exists yet + blank frontmatter + no blocks -> no write', () => {
        expect(shouldWriteCompanionDoc('', '', [])).toBe(false)
    })
    test('no companion exists yet + the user actually typed a tag -> write (lazy creation)', () => {
        expect(shouldWriteCompanionDoc('', '---\ntags: [new]\n---\n', [])).toBe(
            true,
        )
    })
    test('no companion exists yet + untouched frontmatter + one block has non-blank text -> write', () => {
        expect(
            shouldWriteCompanionDoc('', EMPTY_FRONTMATTER, [block('hi')]),
        ).toBe(true)
    })
    test('no companion exists yet + untouched frontmatter + every block is blank -> no write', () => {
        expect(
            shouldWriteCompanionDoc('', EMPTY_FRONTMATTER, [
                block(''),
                block('   \n'),
            ]),
        ).toBe(false)
    })
    test('a companion already exists -> always write, even back to the empty template with no blocks', () => {
        const existing = '---\ntags: [a]\n---\n'
        expect(shouldWriteCompanionDoc(existing, EMPTY_FRONTMATTER, [])).toBe(
            true,
        )
        expect(
            shouldWriteCompanionDoc(existing, '---\ntags: [a, b]\n---\n', []),
        ).toBe(true)
    })
    test('a companion exists with a body but empty frontmatter -> still writes', () => {
        expect(
            shouldWriteCompanionDoc('just a body\n', EMPTY_FRONTMATTER, []),
        ).toBe(true)
    })
})
