import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiOnRenderedPages, registerAiTranscriber, transcribe, setTranscribeEngines, type AiPageDeps } from '../src/transcribe'
import { tempDir } from './tempDirs'

const target = { provider: 'auto' }

function deps(over: Partial<AiPageDeps> = {}) {
    const sent: { page: number; path: string }[][] = []
    const d: AiPageDeps = {
        renderPages: async (_abs, dir) => [{ page: 1, path: `${dir}/p1.png` }],
        aiTranscribe: async images => {
            sent.push(images)
            return images.map(i => ({ page: i.page, text: 'x' }))
        },
        ...over,
    }
    return { d, sent }
}

test('an image page reaches ai as the rendered path, not the original file', async () => {
    const { d, sent } = deps()
    await aiOnRenderedPages('/v/pages/a.heic', 'image', undefined, target, d)
    expect(sent).toHaveLength(1)
    expect(sent[0][0].path).toMatch(/bismuth-pages-.*\/p1\.png$/)
})

test('a heic with no helper fails instead of sending the raw file', async () => {
    const { d, sent } = deps({
        renderPages: async () => {
            throw new Error('no helper')
        },
    })
    await expect(aiOnRenderedPages('/v/pages/a.heic', 'image', undefined, target, d)).rejects.toThrow('no helper')
    expect(sent).toHaveLength(0)
})

test('a png with no helper falls back to the file itself', async () => {
    const { d, sent } = deps({
        renderPages: async () => {
            throw new Error('no helper')
        },
    })
    await aiOnRenderedPages('/v/pages/a.png', 'image', undefined, target, d)
    expect(sent[0]).toEqual([{ page: 1, path: '/v/pages/a.png' }])
})

test('a pdf with no helper fails and only a pdf passes its page list to the renderer', async () => {
    const seen: (number[] | undefined)[] = []
    const { d } = deps({
        renderPages: async (_a, dir, o) => {
            seen.push(o?.pages)
            return [{ page: 3, path: `${dir}/p3.png` }]
        },
    })
    await aiOnRenderedPages('/v/b.pdf', 'pdf', [3], target, d)
    await aiOnRenderedPages('/v/a.png', 'image', [3], target, d)
    expect(seen).toEqual([[3], undefined])
    const failing = deps({
        renderPages: async () => {
            throw new Error('no helper')
        },
    })
    await expect(aiOnRenderedPages('/v/b.pdf', 'pdf', undefined, target, failing.d)).rejects.toThrow('no helper')
})

test('engine ai with no transcriber registered answers AI_UNAVAILABLE 503', async () => {
    setTranscribeEngines(null)
    // The CLI registers the real one at import; a test file loaded beside it must not run a turn.
    registerAiTranscriber(undefined)
    const root = tempDir('bismuth-noai-')
    writeFileSync(join(root, 'a.png'), 'x')
    await expect(transcribe(root, { file: 'a.png', engine: 'ai' })).rejects.toMatchObject({
        code: 'AI_UNAVAILABLE',
        statusCode: 503,
    })
})
