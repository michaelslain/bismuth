import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    DEFAULT_DAEMON_IDENTITY,
    identitySeed,
    setDaemonIdentityName,
} from '../src/daemonIdentity'
import { parseFrontmatter } from '../src/frontmatter'
import { tempDir } from './tempDirs'

const tmp = () => tempDir('daemon-identity-')

describe('identitySeed', () => {
    it('is the stock file the daemon has always seeded', () => {
        expect(identitySeed()).toBe(
            `---\nname: daemon\n---\n\n${DEFAULT_DAEMON_IDENTITY}\n`,
        )
    })
    it('carries a given name in frontmatter over the same body', () => {
        const seed = identitySeed('Ada: the second')
        expect(parseFrontmatter(seed).data.name).toBe('Ada: the second')
        expect(seed.endsWith(`${DEFAULT_DAEMON_IDENTITY}\n`)).toBe(true)
    })
})

describe('setDaemonIdentityName', () => {
    it('creates the stock seed with the name when the daemon has not seeded yet', () => {
        const file = join(tmp(), '.daemon', 'identity.md')
        expect(setDaemonIdentityName(file, '  ada ')).toBe('ada')
        expect(readFileSync(file, 'utf8')).toBe(identitySeed('ada'))
    })
    it('edits only the name of an existing file, keeping its body and keys', () => {
        const file = join(tmp(), 'identity.md')
        writeFileSync(file, '---\nname: daemon\nmood: dry\n---\n\nmy own words\n')
        setDaemonIdentityName(file, 'ada')
        const text = readFileSync(file, 'utf8')
        expect(parseFrontmatter(text).data).toEqual({ name: 'ada', mood: 'dry' })
        expect(text.endsWith('my own words\n')).toBe(true)
    })
    it('refuses a blank name', () => {
        expect(() => setDaemonIdentityName(join(tmp(), 'identity.md'), ' \n ')).toThrow()
    })
})
