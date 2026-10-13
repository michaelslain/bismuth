import { expect, test } from 'bun:test'
import { resolveOpenTarget } from '../src/openTarget'

const VAULT = '/v/my vault'
const files = new Set(['notes/a.md', 'papers/Textbook (9E).pdf', '.settings'])
const exists = async (rel: string) => files.has(rel)
const open = (content: string) => resolveOpenTarget(VAULT, content, exists)

test('a vault-relative path that exists opens as given', async () => {
    expect(await open('papers/Textbook (9E).pdf')).toEqual({
        ok: true,
        content: 'papers/Textbook (9E).pdf',
    })
})

test('sentinels and .settings pass through without a lookup', async () => {
    for (const s of ['::graph', '::daemon', '::term:abc', '.settings'])
        expect(await open(s)).toEqual({ ok: true, content: s })
})

test('an absolute path inside the vault becomes vault-relative', async () => {
    expect(await open(`${VAULT}/notes/a.md`)).toEqual({
        ok: true,
        content: 'notes/a.md',
    })
})

test('a leading ./ is dropped and a bare note name gains .md', async () => {
    expect(await open('./notes/a')).toEqual({ ok: true, content: 'notes/a.md' })
})

test('a path naming no file is refused with what app open accepts', async () => {
    const r = await open('notes/missing.md')
    expect(r.ok).toBe(false)
    if (!r.ok) {
        expect(r.error).toContain('no file "notes/missing.md"')
        expect(r.error).toContain('vault-relative path')
    }
})

test('a #page anchor is refused and says anchors do not jump', async () => {
    const r = await open('papers/Textbook (9E).pdf#page=124')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('#page')
})

test('an absolute path outside the vault and a ../ escape are refused', async () => {
    const outside = await open('/etc/passwd')
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.error).toContain('outside the vault')
    expect((await open('notes/../../x.md')).ok).toBe(false)
})
