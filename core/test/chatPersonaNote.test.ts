import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatPersonaNote } from '../src/chatPersonaNote'
import { tempDir } from './tempDirs'

describe('chatPersonaNote', () => {
    test('names the daemon from its identity file', () => {
        const vault = tempDir('bismuth-persona-')
        mkdirSync(join(vault, '.daemon'))
        writeFileSync(join(vault, '.daemon', 'identity.md'), '---\nname: m\n---\n\nbody\n')
        const note = chatPersonaNote(vault)
        expect(note).toStartWith("You are m, this vault's Bismuth daemon")
        expect(note).toContain('answer to the name m')
    })

    test('a vault with no daemon identity gets no line', () => {
        expect(chatPersonaNote(tempDir('bismuth-persona-none-'))).toBe('')
    })
})
