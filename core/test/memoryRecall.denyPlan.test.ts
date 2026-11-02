import { test, expect, mock, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './tempDirs'

const chatHit = { kind: 'chat', id: 'c1', score: 0.9, excerpt: 'you: x claude: y', title: 'chat', hash: 'h' }
const realChatEmbed = { ...(await import('../src/chatEmbed')) }
mock.module('../src/chatEmbed', () => ({ ...realChatEmbed, chatSourceHits: async () => [chatHit] }))
afterAll(() => {
    mock.module('../src/chatEmbed', () => realChatEmbed)
})

const { sourcesFor, invalidateRecallDenyPlans } = await import('../src/memoryRecall')

const vaultWith = (frontmatter: string | null) => {
    const v = realpathSync(tempDir('recall-deny-'))
    mkdirSync(join(v, 'notes'))
    writeFileSync(join(v, 'notes', 'a.md'), frontmatter ? `---\nvisibility: ${frontmatter}\n---\nbody\n` : 'body\n')
    return v
}
const q = {
    vec: new Float32Array(2),
    k: 5,
    channel: 'chat' as const,
    switches: { files: false, chats: true, docs: false },
}

test('a vault that hides a note recalls no past chats', async () => {
    const v = vaultWith('hidden')
    expect(await sourcesFor(v, q as any)).toEqual([])
})

test('a vault that restricts nothing recalls past chats', async () => {
    const v = vaultWith(null)
    expect((await sourcesFor(v, q as any)).map(h => h.id)).toEqual(['c1'])
})

test('invalidateRecallDenyPlans makes the next call re-resolve', async () => {
    const v = vaultWith(null)
    expect(await sourcesFor(v, q as any)).toHaveLength(1)
    writeFileSync(join(v, 'notes', 'a.md'), '---\nvisibility: hidden\n---\nbody\n')
    expect(await sourcesFor(v, q as any)).toHaveLength(1) // cached plan
    invalidateRecallDenyPlans(v)
    expect(await sourcesFor(v, q as any)).toEqual([])
})
