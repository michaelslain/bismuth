import { expect, test } from 'bun:test'
import { actionBarPhrase, inboxPageReadouts } from './inboxPageMeta'

const base = { status: 'pending' as const, source: 'cron:answer-emails' as string | undefined, createdAt: new Date(Date.now() - 2 * 3600e3).toISOString() }

test('readouts: status word, source without cron prefix, age', () => {
    const r = inboxPageReadouts(base)
    expect(r[0]).toBe('needs review')
    expect(r[1]).toBe('from answer-emails')
    expect(r).toHaveLength(3)
})
test('readouts drop a missing source', () => {
    expect(inboxPageReadouts({ ...base, source: undefined })).toHaveLength(2)
})
test('phrases', () => {
    expect(actionBarPhrase({ status: 'pending' })).toBe('waiting on you')
    expect(actionBarPhrase({ status: 'working' })).toBe('working…')
    expect(actionBarPhrase({ status: 'failed' })).toBe('failed // the daemon could not finish')
    expect(actionBarPhrase({ status: 'failed', daemonNote: 'token expired' })).toBe('failed // token expired')
    expect(actionBarPhrase({ status: 'done', daemonNote: 'sent 3 replies' })).toBe('done // sent 3 replies')
    expect(actionBarPhrase({ status: 'done' })).toBe('done')
    expect(actionBarPhrase({ status: 'dismissed' })).toBe('dismissed')
})
