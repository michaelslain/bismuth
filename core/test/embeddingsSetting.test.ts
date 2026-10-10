import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './helpers'
import { readEmbeddingsEnabledSync } from '../src/embeddingsSetting'

async function vaultWith(settings: string | null): Promise<string> {
    const vault = await tempDir('bismuth-embeddings-')
    if (settings !== null) writeFileSync(join(vault, '.settings'), settings)
    return vault
}

test('embeddings.enabled true reads true', async () => {
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings:\n  enabled: true\n'))).toBe(true)
})

test('embeddings.enabled false reads false', async () => {
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings:\n  enabled: false\n'))).toBe(false)
})

test('a missing file, empty file or absent key reads false', async () => {
    expect(readEmbeddingsEnabledSync(await vaultWith(null))).toBe(false)
    expect(readEmbeddingsEnabledSync(await vaultWith(''))).toBe(false)
    expect(readEmbeddingsEnabledSync(await vaultWith('graph:\n  spin: false\n'))).toBe(false)
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings: {}\n'))).toBe(false)
})

test('a non-boolean value reads false', async () => {
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings:\n  enabled: "true"\n'))).toBe(false)
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings:\n  enabled: 1\n'))).toBe(false)
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings: true\n'))).toBe(false)
})

test('a corrupt file or a directory at the path never throws and reads false', async () => {
    expect(readEmbeddingsEnabledSync(await vaultWith('embeddings: [unclosed\n  : :\n'))).toBe(false)
    const vault = await vaultWith(null)
    mkdirSync(join(vault, '.settings'))
    expect(readEmbeddingsEnabledSync(vault)).toBe(false)
    expect(readEmbeddingsEnabledSync(join(vault, 'does-not-exist'))).toBe(false)
})

test('the old daemon.recall.semantic key is not read', async () => {
    expect(
        readEmbeddingsEnabledSync(await vaultWith('daemon:\n  recall:\n    semantic: true\n')),
    ).toBe(false)
})
