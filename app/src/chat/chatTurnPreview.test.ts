import { describe, expect, test } from 'bun:test'
import { chatTurnPreview } from './chatTurnPreview'

describe('chatTurnPreview', () => {
    test('takes the first non-blank line', () => {
        expect(chatTurnPreview('\n\nA few things landed:\n- one')).toBe(
            'A few things landed:',
        )
    })

    test('drops block prefixes', () => {
        expect(chatTurnPreview('## Setup steps')).toBe('Setup steps')
        expect(chatTurnPreview('- [x] ship it')).toBe('ship it')
        expect(chatTurnPreview('> quoted')).toBe('quoted')
        expect(chatTurnPreview('3. third')).toBe('third')
    })

    test('drops inline marks and keeps link text', () => {
        expect(
            chatTurnPreview(
                '**Faster** `startup` in [[notes/daemon|the daemon]] [docs](x.md)',
            ),
        ).toBe('Faster startup in the daemon docs')
    })

    test('skips a leading code fence', () => {
        expect(chatTurnPreview('```sh\nbun run x\n```\nThen restart.')).toBe(
            'Then restart.',
        )
    })

    test('empty for blank text', () => {
        expect(chatTurnPreview('  \n ')).toBe('')
    })
})
