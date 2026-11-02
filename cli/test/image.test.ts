import { describe, expect, test } from 'bun:test'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { imageDescribeDeps } from '../../core/src/imageDescribe'
import { commands } from '../src/commands/image'
import { registry, resolveCommand } from '../src/registry'

describe('image describe', () => {
    test('is registered and resolves as a two-word command', () => {
        expect(resolveCommand(['image', 'describe', 'a.png'])).toBe('image describe')
        expect(registry['image describe']).toBe(commands['image describe'])
    })

    test('prints the DescribeResult and writes the companion', async () => {
        const v = makeVault({})
        writeFileSync(join(v, 'a.png'), Buffer.from([1, 2, 3]))
        const real = imageDescribeDeps.describe
        imageDescribeDeps.describe = async () => 'a red square'
        const lines: string[] = []
        const log = console.log
        console.log = (...a: unknown[]) => void lines.push(a.join(' '))
        try {
            await commands['image describe'].run(['a.png', '--vault', v])
        } finally {
            console.log = log
            imageDescribeDeps.describe = real
        }
        expect(JSON.parse(lines.join('\n'))).toEqual({
            path: 'a.png',
            companion: 'a.png.md',
            description: 'a red square',
        })
        expect(readFileSync(join(v, 'a.png.md'), 'utf8')).toContain('description: a red square')
    })
})
