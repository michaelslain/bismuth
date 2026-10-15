import { describe, expect, test } from 'bun:test'
import {
    bareAddress,
    composePageEmail,
    newMessageId,
    requestPage,
    sameAddress,
    stripQuoted,
} from '../src/daemon/emailFormat'

const actions = [
    { id: 'send', label: 'Send replies', prompt: 'Send them.' },
    { id: 'discard', label: 'Discard' },
]

describe('stripQuoted', () => {
    test('the Gmail quote, wrapped over two lines, is cut', () => {
        const text = [
            'yes send it but say Q3 is fine',
            '',
            'On Tue, Oct 13, 2026 at 2:10 PM Michael <me@example.com>',
            'wrote:',
            '> Reply to Jane: Q3 budget looks fine.',
        ].join('\n')
        expect(stripQuoted(text)).toBe('yes send it but say Q3 is fine')
    })

    test('quoted lines, signatures and Outlook headers are cut', () => {
        expect(stripQuoted('run\n> old')).toBe('run')
        expect(stripQuoted('run\n-- \nMichael')).toBe('run')
        expect(stripQuoted('run\n\nSent from my iPhone')).toBe('run')
        expect(stripQuoted('run\n-----Original Message-----\nFrom: x')).toBe('run')
    })

    test('a line that merely starts with "On" is kept', () => {
        expect(stripQuoted('send\nOn Monday we ship.')).toBe('send\nOn Monday we ship.')
    })
})

describe('addresses', () => {
    test('bare address from a display form', () => {
        expect(bareAddress('Michael <Me@Example.com>')).toBe('me@example.com')
        expect(sameAddress('me@example.com', 'M <ME@example.com>')).toBe(true)
        expect(sameAddress('me@example.com', 'me+x@example.com')).toBe(false)
    })
})

test('message ids are unique and carry the sender domain', () => {
    const a = newMessageId('reply-drafts', 'me@example.com')
    const b = newMessageId('reply-drafts', 'me@example.com')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^<bismuth\.reply-drafts\.[0-9a-f]{18}@example\.com>$/)
})

test('the page email lists the commands and the vault', () => {
    const text = composePageEmail(
        { slug: 's', title: 'T', body: 'Draft', source: 'cron:answer-emails', actions },
        'vault',
    )
    expect(text).toContain('Draft\n')
    expect(text).toContain('Reply in your own words')
    expect(text).toContain("buttons: send replies // discard.")
    expect(text).toContain('From vault // answer-emails')
})

test('a request page waits for a run press', () => {
    const p = requestPage('Book a table', 'for two at 7\n\n-- \nme', new Date('2026-10-13T21:10:16Z'))
    expect(p.slug).toMatch(/^email-20261013t211016-[0-9a-f]{4}$/)
    expect(p.title).toBe('Book a table')
    expect(p.body).toBe('for two at 7')
    expect(p.actions.map(a => a.id)).toEqual(['run', 'dismiss'])
    expect(p.actions[0]?.prompt).toBeTruthy()
    expect(p.actions[1]?.prompt).toBeUndefined()
})
