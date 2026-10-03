import { describe, expect, it } from 'bun:test'
import { createFrame, frameToText } from '../../ui/ascii/glyphScene'
import { CARET, createBeginScene } from './begin'

const beginScene = createBeginScene(1000)

const text = (t: number) => {
    const f = createFrame(beginScene.cols, beginScene.rows)
    beginScene.frame(t, f)
    return frameToText(f).split('\n')
}

describe('beginScene', () => {
    it('types the prompt in, then the caret blinks', () => {
        expect(text(0)[13].trim()).toBe('')
        expect(text(beginScene.revealMs)[13].trim()).toBe(
            `> open vault${CARET}`,
        )
        expect(text(beginScene.revealMs + 500)[13].trim()).toBe('> open vault')
        expect(text(beginScene.revealMs + 1000)[13].trim()).toBe(
            `> open vault${CARET}`,
        )
    })
    it('the wordmark is formed from t = 0', () => {
        expect(
            text(0).slice(3, 12).join('').replace(/[^#@]/g, '').length,
        ).toBeGreaterThan(150)
    })
})
