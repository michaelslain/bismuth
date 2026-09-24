import { expect, test, describe } from 'bun:test'
import { baseName, attachmentTarget } from './attachmentPath'

describe('baseName', () => {
    test('posix + windows separators', () => {
        expect(baseName('/Users/me/Desktop/photo.png')).toBe('photo.png')
        expect(baseName('C:\\Users\\me\\photo.png')).toBe('photo.png')
        expect(baseName('photo.png')).toBe('photo.png')
        expect(baseName('a/b\\c/d.jpg')).toBe('d.jpg')
    })
})

describe('attachmentTarget', () => {
    test('named folder', () => {
        expect(attachmentTarget('attachments', 'a.png', 'board/card.md')).toBe(
            'attachments/a.png',
        )
    })
    test('empty folder = vault root', () => {
        expect(attachmentTarget('', 'a.png', 'board/card.md')).toBe('a.png')
    })
    test('"." = the note\'s own folder', () => {
        expect(attachmentTarget('.', 'a.png', 'board/sub/card.md')).toBe(
            'board/sub/a.png',
        )
        expect(attachmentTarget('.', 'a.png', 'card.md')).toBe('a.png') // note at vault root
        expect(attachmentTarget('.', 'a.png', null)).toBe('a.png')
    })
    test('strips stray leading/trailing slashes on the folder', () => {
        expect(attachmentTarget('/attachments/', 'a.png', 'x.md')).toBe(
            'attachments/a.png',
        )
    })
    test('"" = vault root, named folder, "." = note folder, stray slashes stripped', () => {
        expect(attachmentTarget('', 'a.png', 'n/x.md')).toBe('a.png')
        expect(attachmentTarget('att', 'a.png', 'n/x.md')).toBe('att/a.png')
        expect(attachmentTarget('.', 'a.png', 'n/x.md')).toBe('n/a.png')
        expect(attachmentTarget('.', 'a.png', 'x.md')).toBe('a.png')
        expect(attachmentTarget('/att/', 'a.png', null)).toBe('att/a.png')
    })
})
