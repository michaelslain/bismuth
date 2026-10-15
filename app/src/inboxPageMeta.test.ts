import { expect, test } from 'bun:test'
import {
    actionBarNote,
    actionBarPhrase,
    canReply,
    replyHint,
    inboxPageReadouts,
    pageSender,
    replyPlaceholder,
} from './inboxPageMeta'

const base = { status: 'pending' as const, source: 'cron:answer-emails' as string | undefined, createdAt: new Date(Date.now() - 2 * 3600e3).toISOString() }

test('readout: the status word; sender and age live in the message header', () => {
    expect(inboxPageReadouts(base)).toEqual(['needs review'])
})
test('sender: source without the cron prefix, or none', () => {
    expect(pageSender(base)).toBe('answer-emails')
    expect(pageSender({ source: 'email' })).toBe('email')
    expect(pageSender({ source: undefined })).toBeNull()
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
test('a page being read says so', () => {
    expect(actionBarPhrase({ status: 'working', replying: true })).toBe('reading your reply…')
})
test('replies are accepted where a press is', () => {
    expect(canReply({ status: 'pending' })).toBe(true)
    expect(canReply({ status: 'failed' })).toBe(true)
    expect(canReply({ status: 'working' })).toBe(false)
    expect(canReply({ status: 'done' })).toBe(false)
    expect(replyPlaceholder({ status: 'pending' })).toBe('reply in your own words')
})
test('the note line is only a failure; questions live in the thread', () => {
    expect(actionBarNote({ status: 'pending' })).toBeNull()
    expect(actionBarNote({ status: 'failed', daemonNote: 'token expired' })).toBe('failed // token expired')
    expect(actionBarNote({ status: 'done' })).toBeNull()
})
test('the reply hint names the live send key', () => {
    expect(replyHint('Enter')).toBe('enter sends // shift+enter new line')
    expect(replyHint('Mod+Enter, Enter')).toBe('mod+enter sends')
    expect(replyHint('')).toBe('')
    expect(replyHint(undefined)).toBe('')
})
