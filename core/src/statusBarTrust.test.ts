import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hasHiddenChars, isCommandTrusted, trustCommand, trustFilePath } from './statusBarTrust'

let dir: string
let prev: string | undefined
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sbtrust-'))
    prev = process.env.BISMUTH_TRUST_FILE
    process.env.BISMUTH_TRUST_FILE = join(dir, 'sub', 'trusted.json')
})
afterEach(() => {
    if (prev === undefined) delete process.env.BISMUTH_TRUST_FILE
    else process.env.BISMUTH_TRUST_FILE = prev
})

describe('statusBarTrust', () => {
    test('untrusted by default', () => {
        expect(isCommandTrusted(dir, 'git branch')).toBe(false)
    })
    test('trusted after trustCommand, idempotent', () => {
        trustCommand(dir, 'git branch')
        trustCommand(dir, 'git branch')
        expect(isCommandTrusted(dir, 'git branch')).toBe(true)
    })
    test('one-character edit is untrusted', () => {
        trustCommand(dir, 'git branch')
        expect(isCommandTrusted(dir, 'git branch ')).toBe(false)
        expect(isCommandTrusted(dir, 'git branc')).toBe(false)
    })
    test('different vault is untrusted', () => {
        trustCommand(dir, 'git branch')
        expect(isCommandTrusted(mkdtempSync(join(tmpdir(), 'sbtrust2-')), 'git branch')).toBe(false)
    })
    test('corrupt file reads as nothing trusted and is rewritten', () => {
        trustCommand(dir, 'a')
        writeFileSync(trustFilePath(), '{not json')
        expect(isCommandTrusted(dir, 'a')).toBe(false)
        trustCommand(dir, 'b')
        expect(isCommandTrusted(dir, 'b')).toBe(true)
    })
    test('file mode is 0600', () => {
        trustCommand(dir, 'a')
        expect(statSync(trustFilePath()).mode & 0o777).toBe(0o600)
    })
    test('write is atomic: no tmp file left behind', () => {
        trustCommand(dir, 'a')
        trustCommand(dir, 'b')
        expect(readdirSync(dirname(trustFilePath())).filter(f => f.endsWith('.tmp'))).toEqual([])
        expect(statSync(trustFilePath()).mode & 0o777).toBe(0o600)
    })
    test('hasHiddenChars flags newlines and bidi controls', () => {
        expect(hasHiddenChars('echo hi')).toBe(false)
        expect(hasHiddenChars('echo a\ncurl x')).toBe(true)
        expect(hasHiddenChars('echo \u202Eabc')).toBe(true)
        expect(hasHiddenChars('echo \u2066x')).toBe(true)
    })
    test('trustCommand refuses a command with hidden characters', () => {
        for (const c of ['echo a\ncurl x', 'echo \u202Eabc', 'echo \u2066x']) {
            expect(() => trustCommand(dir, c)).toThrow('cannot be approved')
            expect(isCommandTrusted(dir, c)).toBe(false)
        }
    })
})
