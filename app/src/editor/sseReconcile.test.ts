import { test, expect } from 'bun:test'
import { decideSseReconcile } from './sseReconcile'

const base = { pendingSaveAfterRead: false, docBeforeRead: 'abc', docAfterRead: 'abc', onDisk: 'abc', lastSavedText: undefined }

test('the user typed while the read was in flight → abort, never touch the buffer', () => {
    expect(decideSseReconcile({ ...base, docAfterRead: 'abcX', onDisk: 'ab' })).toBe('abort')
})
test('a save became pending during the read → abort', () => {
    expect(decideSseReconcile({ ...base, pendingSaveAfterRead: true, onDisk: 'zzz' })).toBe('abort')
})
test('disk equals buffer → noop', () => {
    expect(decideSseReconcile(base)).toBe('noop')
})
test('disk is our own last save → own-echo', () => {
    expect(decideSseReconcile({ ...base, docBeforeRead: 'abcd', docAfterRead: 'abcd', onDisk: 'abc', lastSavedText: 'abc' })).toBe('own-echo')
})
test('a genuine external change with an untouched buffer → reconcile', () => {
    expect(decideSseReconcile({ ...base, onDisk: 'abZ' })).toBe('reconcile')
})
