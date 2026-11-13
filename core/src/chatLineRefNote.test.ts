import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    CHAT_LINE_REF_NOTE,
    chatLineRefNote,
    chatLineRefNoteFor,
    readLineNumbersSetting,
} from './chatLineRefNote'

const dirs: string[] = []
function vault(settings?: string): string {
    const d = mkdtempSync(join(tmpdir(), 'line-ref-'))
    dirs.push(d)
    if (settings !== undefined) writeFileSync(join(d, '.settings'), settings)
    return d
}
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

test('the note names the anchor form the transcript renders', () => {
    expect(CHAT_LINE_REF_NOTE).toContain('[[Note#L12]]')
    expect(CHAT_LINE_REF_NOTE).toContain('[[Note#L12-L18]]')
    expect(chatLineRefNote(true)).toBe(CHAT_LINE_REF_NOTE)
    expect(chatLineRefNote(false)).toBe('')
})

describe('readLineNumbersSetting', () => {
    test('on when editor.lineNumbers is true, from a subfolder too', async () => {
        const v = vault('editor:\n  lineNumbers: true\n')
        mkdirSync(join(v, 'notes'))
        expect(await readLineNumbersSetting(v)).toBe(true)
        expect(await readLineNumbersSetting(join(v, 'notes'))).toBe(true)
        expect(await chatLineRefNoteFor(v)).toBe(CHAT_LINE_REF_NOTE)
    })
    test('off when false, absent, or malformed', async () => {
        expect(await readLineNumbersSetting(vault('editor:\n  lineNumbers: false\n'))).toBe(false)
        expect(await readLineNumbersSetting(vault('editor:\n  livePreview: true\n'))).toBe(false)
        expect(await readLineNumbersSetting(vault(': : [\n'))).toBe(false)
        expect(await chatLineRefNoteFor(vault(''))).toBe('')
    })
    test('off outside a vault', async () => {
        expect(await readLineNumbersSetting(vault())).toBe(false)
    })
})
