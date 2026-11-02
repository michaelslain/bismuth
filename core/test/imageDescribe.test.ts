import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from './helpers'
import { AppError } from '../src/error'
import { parseFrontmatter } from '../src/frontmatter'
import {
    describeImage,
    imageDescribeDeps,
    syncImageDescriptions,
    MAX_DESCRIPTION_CHARS,
} from '../src/imageDescribe'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const original = { ...imageDescribeDeps }
let calls: string[]
let marked: string[]

beforeEach(() => {
    calls = []
    marked = []
    imageDescribeDeps.describe = async ({ path }) => {
        calls.push(path)
        return `  a whiteboard\nwith text "ship it"  `
    }
    imageDescribeDeps.marks = {
        mark: p => marked.push(`mark ${p}`),
        rearm: p => marked.push(`rearm ${p}`),
        unmark: p => marked.push(`unmark ${p}`),
    }
})
afterEach(() => Object.assign(imageDescribeDeps, original))

function vaultWithImage(extra: Record<string, string> = {}): string {
    const v = makeVault({ ...extra })
    writeFileSync(join(v, 'board.png'), PNG)
    return v
}
const companion = (v: string) => readFileSync(join(v, 'board.png.md'), 'utf8')

describe('describeImage', () => {
    test('writes description + hash into a created companion and marks the write', async () => {
        const v = vaultWithImage()
        const r = await describeImage(v, 'board.png')
        expect(r).toEqual({
            path: 'board.png',
            companion: 'board.png.md',
            description: 'a whiteboard with text "ship it"',
        })
        const fm = parseFrontmatter(companion(v)).data
        expect(fm.description).toBe(r.description)
        expect(typeof fm.describedHash).toBe('string')
        expect(marked).toEqual(['mark board.png.md', 'rearm board.png.md'])
    })

    test('tells the written hook the companion path after the write', async () => {
        const v = vaultWithImage()
        const got: string[][] = []
        imageDescribeDeps.written = p => {
            got.push(p)
        }
        await describeImage(v, 'board.png')
        expect(got).toEqual([['board.png.md']])
    })

    test('keeps other keys and the body of an existing companion', async () => {
        const v = vaultWithImage({ 'board.png.md': '---\ntags: [a, b]\n---\nmy notes\n' })
        await describeImage(v, 'board.png')
        const md = companion(v)
        expect(md).toContain('tags: [a, b]')
        expect(md).toContain('my notes')
        expect(parseFrontmatter(md).data.description).toBeTruthy()
    })

    test('same hash skips without calling Claude; force describes again', async () => {
        const v = vaultWithImage()
        await describeImage(v, 'board.png')
        const again = await describeImage(v, 'board.png')
        expect(again.skipped).toBe('unchanged')
        expect(calls).toHaveLength(1)
        await describeImage(v, 'board.png', { force: true })
        expect(calls).toHaveLength(2)
    })

    test('changed bytes are described again', async () => {
        const v = vaultWithImage()
        await describeImage(v, 'board.png')
        writeFileSync(join(v, 'board.png'), Buffer.concat([PNG, Buffer.from([1])]))
        await describeImage(v, 'board.png')
        expect(calls).toHaveLength(2)
    })

    test('caps the description length', async () => {
        const v = vaultWithImage()
        imageDescribeDeps.describe = async () => 'x'.repeat(2000)
        const r = await describeImage(v, 'board.png')
        expect(r.description.length).toBe(MAX_DESCRIPTION_CHARS)
    })

    test('over 5 MB is skipped too-large', async () => {
        const v = vaultWithImage()
        writeFileSync(join(v, 'big.png'), Buffer.alloc(5 * 1024 * 1024 + 1))
        expect((await describeImage(v, 'big.png')).skipped).toBe('too-large')
        expect(calls).toHaveLength(0)
    })

    test('an image hidden from the daemon is skipped hidden', async () => {
        const v = vaultWithImage({ 'private/.visibility.md': '' })
        writeFileSync(join(v, 'private', 'secret.png'), PNG)
        writeFileSync(join(v, 'private', 'secret.png.md'), '---\nvisibility: hidden\n---\n')
        const r = await describeImage(v, 'private/secret.png')
        expect(r.skipped).toBe('hidden')
        expect(calls).toHaveLength(0)
    })

    test('a non-image is BAD_REQUEST', async () => {
        const v = vaultWithImage({ 'a.md': 'x' })
        const e = await describeImage(v, 'a.md').catch(x => x)
        expect(e).toBeInstanceOf(AppError)
        expect(e.code).toBe('BAD_REQUEST')
    })

    test('no claude gives the install hint', async () => {
        const v = vaultWithImage()
        Object.assign(imageDescribeDeps, original)
        imageDescribeDeps.whichClaude = () => null
        const e = await describeImage(v, 'board.png').catch(x => x)
        expect(e).toBeInstanceOf(AppError)
        expect(e.message).toContain('Claude Code installed')
    })
})

describe('syncImageDescriptions', () => {
    const settle = () => new Promise(r => setTimeout(r, 50))
    const on = '---\nembeddings:\n  enabled: true\n  describeImages: true\n---\n'
    const asSettings = (s: string) => s.replace(/^---\n|---\n$/g, '')

    test('is a no-op while the switch is off', async () => {
        const v = vaultWithImage({ '.settings': asSettings('embeddings:\n  enabled: true\n  describeImages: false\n---\n') })
        syncImageDescriptions(v)
        syncImageDescriptions(v, ['board.png'])
        await settle()
        expect(calls).toHaveLength(0)
    })

    test('describes changed images, and every image at boot', async () => {
        const v = vaultWithImage({ '.settings': asSettings(on), 'sub/n.md': 'x' })
        writeFileSync(join(v, 'sub', 'two.jpg'), PNG)
        syncImageDescriptions(v, ['board.png', 'notes.md'])
        await settle()
        expect(calls).toEqual(['board.png'])
        syncImageDescriptions(v)
        await settle()
        expect(calls.sort()).toEqual(['board.png', 'sub/two.jpg'])
    })

    test('a drain pass resolves the deny plan once, not once per image', async () => {
        const v = vaultWithImage({ '.settings': asSettings(on), 'sub/n.md': 'x' })
        writeFileSync(join(v, 'sub', 'two.jpg'), PNG)
        writeFileSync(join(v, 'sub', 'three.png'), PNG)
        let walks = 0
        imageDescribeDeps.denyPlan = (...a) => {
            walks++
            return original.denyPlan(...a)
        }
        syncImageDescriptions(v)
        await settle()
        expect(calls).toHaveLength(3)
        expect(walks).toBe(1)
    })
})
