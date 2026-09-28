import { describe, expect, test } from 'bun:test'
import { parseTaskInline } from './taskInline'

describe('parseTaskInline', () => {
    test('plain text is one text segment', () => {
        expect(parseTaskInline('ship it')).toEqual([{ kind: 'text', text: 'ship it' }])
    })
    test('empty string yields nothing', () => {
        expect(parseTaskInline('')).toEqual([])
    })
    test('[[Note]] label is the last path part', () => {
        expect(parseTaskInline('see [[Note]]')).toEqual([
            { kind: 'text', text: 'see ' },
            { kind: 'wikilink', target: 'Note', label: 'Note' },
        ])
        expect(parseTaskInline('[[a/b/Deep]]')).toEqual([
            { kind: 'wikilink', target: 'a/b/Deep', label: 'Deep' },
        ])
    })
    test('[[Note|Alias]] uses the alias', () => {
        expect(parseTaskInline('[[Note|Alias]]')).toEqual([
            { kind: 'wikilink', target: 'Note', label: 'Alias' },
        ])
    })
    test('[x](https://…) is a link', () => {
        expect(parseTaskInline('go [docs](https://example.com/a) now')).toEqual([
            { kind: 'text', text: 'go ' },
            { kind: 'link', url: 'https://example.com/a', label: 'docs' },
            { kind: 'text', text: ' now' },
        ])
    })
    test('javascript: parses as a link (TaskText refuses to open it)', () => {
        expect(parseTaskInline('[x](javascript:alert(1)')).toEqual([
            { kind: 'link', url: 'javascript:alert(1', label: 'x' },
        ])
    })
    test('#tag keeps the preceding whitespace as text', () => {
        expect(parseTaskInline('do #work/now today')).toEqual([
            { kind: 'text', text: 'do' },
            { kind: 'text', text: ' ' },
            { kind: 'tag', name: 'work/now' },
            { kind: 'text', text: ' today' },
        ])
        expect(parseTaskInline('#first')).toEqual([{ kind: 'tag', name: 'first' }])
    })
    test('a # inside a word is not a tag', () => {
        expect(parseTaskInline('c#sharp')).toEqual([{ kind: 'text', text: 'c#sharp' }])
    })
    test('**bold** and *italic*', () => {
        expect(parseTaskInline('**b** and *i*')).toEqual([
            { kind: 'bold', text: 'b' },
            { kind: 'text', text: ' and ' },
            { kind: 'italic', text: 'i' },
        ])
    })
    test('mixed line', () => {
        expect(parseTaskInline('email [[Ann|A]] re **plan** #ops *soon*')).toEqual([
            { kind: 'text', text: 'email ' },
            { kind: 'wikilink', target: 'Ann', label: 'A' },
            { kind: 'text', text: ' re ' },
            { kind: 'bold', text: 'plan' },
            { kind: 'text', text: ' ' },
            { kind: 'tag', name: 'ops' },
            { kind: 'text', text: ' ' },
            { kind: 'italic', text: 'soon' },
        ])
    })
})
