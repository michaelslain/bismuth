import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { beginScene } from './begin'

const text = (t: number) => {
    const f = createFrame(beginScene.cols, beginScene.rows)
    beginScene.frame(t, f)
    return frameToText(f).split('\n')
}

describe('beginScene', () => {
    it('types the prompt in, then the caret blinks', () => {
        expect(text(0)[13].trim()).toBe('')
        expect(text(beginScene.revealMs)[13].trim()).toBe('> open vault_')
        expect(text(beginScene.revealMs + 550)[13].trim()).toBe('> open vault')
        expect(text(beginScene.revealMs + 1100)[13].trim()).toBe(
            '> open vault_',
        )
    })
    it('the wordmark is formed from t = 0', () => {
        expect(
            text(0).slice(3, 12).join('').replace(/[^#@]/g, '').length,
        ).toBeGreaterThan(150)
    })
})
