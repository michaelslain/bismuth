import { describe, expect, test } from 'bun:test'
import {
    basename,
    classifyIntake,
    extensionOf,
    filePathsFromTransfer,
    imageMimeFromName,
    isHeicName,
    jpegNameFor,
} from './fileIntake'

describe('basename / extensionOf', () => {
    test('handles both separators', () => {
        expect(basename('/Users/me/a.png')).toBe('a.png')
        expect(basename('C:\\Users\\me\\a.png')).toBe('a.png')
        expect(basename('a.png')).toBe('a.png')
    })

    test('extension is lowercased and dot-free; missing extension is empty', () => {
        expect(extensionOf('/Users/me/SHOT.PNG')).toBe('png')
        expect(extensionOf('archive.tar.gz')).toBe('gz')
        expect(extensionOf('Makefile')).toBe('')
        expect(extensionOf('/Users/me/Makefile')).toBe('')
    })

    test("a dot in a DIRECTORY name does not become the file's extension", () => {
        expect(extensionOf('/Users/me/album.heic/notes')).toBe('')
        expect(extensionOf('/Users/me/v1.2/report.pdf')).toBe('pdf')
    })
})

describe('imageMimeFromName', () => {
    test('maps the four directly-attachable image types', () => {
        expect(imageMimeFromName('/Users/me/a.png')).toBe('image/png')
        expect(imageMimeFromName('/Users/me/a.jpg')).toBe('image/jpeg')
        expect(imageMimeFromName('/Users/me/a.jpeg')).toBe('image/jpeg')
        expect(imageMimeFromName('/Users/me/a.gif')).toBe('image/gif')
        expect(imageMimeFromName('/Users/me/a.webp')).toBe('image/webp')
    })

    test('is case-insensitive and separator-agnostic', () => {
        expect(imageMimeFromName('/Users/me/SHOT.PNG')).toBe('image/png')
        expect(imageMimeFromName('C:\\Users\\me\\Pic.JPEG')).toBe('image/jpeg')
    })

    test('returns null for HEIC and for non-images', () => {
        // HEIC must NOT be attachable directly — it has to go through conversion.
        expect(imageMimeFromName('photo.heic')).toBeNull()
        for (const n of ['a.pdf', 'a.svg', 'a.txt', 'a.mov', 'noext']) {
            expect(imageMimeFromName(n)).toBeNull()
        }
    })
})

describe('isHeicName / jpegNameFor', () => {
    test('matches both Apple extensions in any case', () => {
        expect(isHeicName('IMG_0042.HEIC')).toBe(true)
        expect(isHeicName('IMG_0042.heic')).toBe(true)
        expect(isHeicName('IMG_0042.heif')).toBe(true)
        expect(isHeicName('/Users/me/Pictures/x.HEIF')).toBe(true)
    })

    test('does not match lookalikes', () => {
        for (const n of ['a.heicx', 'a.heic.txt', 'heic', 'a.jpg']) {
            expect(isHeicName(n)).toBe(false)
        }
    })

    test('renames to .jpg, preserving any directory prefix', () => {
        expect(jpegNameFor('IMG_1.HEIC')).toBe('IMG_1.jpg')
        expect(jpegNameFor('/Users/me/Pictures/IMG_1.heif')).toBe(
            '/Users/me/Pictures/IMG_1.jpg',
        )
    })

    test('leaves non-HEIC names alone', () => {
        expect(jpegNameFor('a.png')).toBe('a.png')
        expect(jpegNameFor('Makefile')).toBe('Makefile')
    })
})

describe('classifyIntake', () => {
    test('routes each kind', () => {
        expect(classifyIntake('/Users/me/shot.png')).toBe('image')
        expect(classifyIntake('/Users/me/IMG_0042.HEIC')).toBe('heic')
        expect(classifyIntake('/Users/me/report.pdf')).toBe('other')
    })

    test('HEIC wins over the image test (it is not directly attachable)', () => {
        expect(classifyIntake('photo.heic')).toBe('heic')
    })

    test('everything unrecognised is `other` — never silently discarded', () => {
        // The regression this whole module exists to prevent: these all used to hit a bare `return`.
        for (const n of [
            'notes.txt',
            'data.csv',
            'deck.key',
            'archive.zip',
            'Makefile',
            'a.svg',
        ]) {
            expect(classifyIntake(n)).toBe('other')
        }
    })
})

describe('filePathsFromTransfer', () => {
    const dt = (data: Record<string, string>) => ({
        getData: (f: string) => data[f] ?? '',
    })

    test('reads a single Finder file URL', () => {
        expect(
            filePathsFromTransfer(
                dt({ 'text/uri-list': 'file:///Users/me/a.png' }),
            ),
        ).toEqual(['/Users/me/a.png'])
    })

    test('percent-decodes spaces and unicode', () => {
        expect(
            filePathsFromTransfer(
                dt({ 'text/uri-list': 'file:///Users/me/My%20Photo.heic' }),
            ),
        ).toEqual(['/Users/me/My Photo.heic'])
        // macOS stores filenames NFD-decomposed, so a real Finder URL encodes `é` as `e` + U+0301.
        // Decoding must reproduce those bytes EXACTLY — normalising to NFC here would build a path
        // that does not open on a case-sensitive volume.
        expect(
            filePathsFromTransfer(
                dt({
                    'text/uri-list': 'file:///Users/me/re%CC%81sume%CC%81.pdf',
                }),
            ),
        ).toEqual(['/Users/me/résumé.pdf'])
    })

    test('reads a multi-file selection, CRLF-separated per RFC 2483', () => {
        expect(
            filePathsFromTransfer(
                dt({
                    'text/uri-list': 'file:///a/1.png\r\nfile:///a/2.pdf\r\n',
                }),
            ),
        ).toEqual(['/a/1.png', '/a/2.pdf'])
    })

    test('skips comments and blank lines', () => {
        expect(
            filePathsFromTransfer(
                dt({ 'text/uri-list': '# comment\n\nfile:///a/1.png\n' }),
            ),
        ).toEqual(['/a/1.png'])
    })

    test('skips non-file URLs — a link dragged from a browser is not a file', () => {
        expect(
            filePathsFromTransfer(
                dt({ 'text/uri-list': 'https://example.com/a.png' }),
            ),
        ).toEqual([])
        expect(
            filePathsFromTransfer(
                dt({
                    'text/uri-list': 'https://example.com/x\nfile:///a/1.png',
                }),
            ),
        ).toEqual(['/a/1.png'])
    })

    test('returns empty for an absent transfer or an absent flavour', () => {
        expect(filePathsFromTransfer(null)).toEqual([])
        expect(filePathsFromTransfer(undefined)).toEqual([])
        expect(filePathsFromTransfer(dt({}))).toEqual([])
        expect(
            filePathsFromTransfer(dt({ 'text/plain': 'file:///a/1.png' })),
        ).toEqual([])
    })

    test('survives a getData that throws (dragover blocks it) instead of killing the drop', () => {
        expect(
            filePathsFromTransfer({
                getData: () => {
                    throw new Error('blocked')
                },
            }),
        ).toEqual([])
    })

    test('drops an unparseable entry but keeps the good ones', () => {
        expect(
            filePathsFromTransfer(
                dt({ 'text/uri-list': 'file:///a/%ZZ\nfile:///a/ok.png' }),
            ),
        ).toEqual(['/a/ok.png'])
    })
})
