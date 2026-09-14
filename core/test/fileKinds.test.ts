import { describe, expect, test } from 'bun:test'
import {
    IMAGE_EXTS,
    extOfPath,
    isImagePath,
    isPdfPath,
    isCompanionable,
    companionPathFor,
    inkSidecarFor,
    binaryForCompanion,
    isTreeListedName,
} from '../src/fileKinds'

describe('extOfPath', () => {
    test('lowercases the basename extension', () => {
        expect(extOfPath('a/b/Photo.PNG')).toBe('png')
        expect(extOfPath('report.PDF')).toBe('pdf')
    })
    test('takes only the LAST extension of a multi-dot name', () => {
        expect(extOfPath('a/x.png.md')).toBe('md')
        expect(extOfPath('deep/dir/report.final.pdf')).toBe('pdf')
    })
    test('no-ext: a basename with no dot returns empty', () => {
        expect(extOfPath('README')).toBe('')
        expect(extOfPath('a/b/Makefile')).toBe('')
    })
    test('dotfile: a leading-dot-only basename returns empty, not the whole name', () => {
        expect(extOfPath('.gitignore')).toBe('')
        expect(extOfPath('a/.settings')).toBe('')
    })
})

describe('isImagePath / isPdfPath / isCompanionable', () => {
    test('every IMAGE_EXTS member classifies as an image, case-insensitively', () => {
        for (const ext of IMAGE_EXTS) {
            expect(isImagePath(`x.${ext}`)).toBe(true)
            expect(isImagePath(`x.${ext.toUpperCase()}`)).toBe(true)
        }
    })
    test('heic/heif/tif/tiff are images', () => {
        expect(isImagePath('scan.heic')).toBe(true)
        expect(isImagePath('scan.HEIF')).toBe(true)
        expect(isImagePath('scan.tif')).toBe(true)
        expect(isImagePath('scan.tiff')).toBe(true)
    })
    test('pdf is a pdf, not an image', () => {
        expect(isPdfPath('doc.pdf')).toBe(true)
        expect(isPdfPath('doc.PDF')).toBe(true)
        expect(isImagePath('doc.pdf')).toBe(false)
    })
    test('isCompanionable is image || pdf, false for notes/other binaries', () => {
        expect(isCompanionable('a.png')).toBe(true)
        expect(isCompanionable('a.pdf')).toBe(true)
        expect(isCompanionable('a.md')).toBe(false)
        expect(isCompanionable('a.mp3')).toBe(false)
        expect(isCompanionable('a')).toBe(false)
    })
})

describe('companionPathFor / inkSidecarFor', () => {
    test('appends the sidecar suffix verbatim', () => {
        expect(companionPathFor('a/x.png')).toBe('a/x.png.md')
        expect(inkSidecarFor('a/x.png')).toBe('a/x.png.draw')
        expect(companionPathFor('doc.pdf')).toBe('doc.pdf.md')
        expect(inkSidecarFor('doc.pdf')).toBe('doc.pdf.draw')
    })
})

describe('binaryForCompanion', () => {
    test('a companion note strips to its binary', () => {
        expect(binaryForCompanion('a/x.png.md')).toBe('a/x.png')
        expect(binaryForCompanion('doc.pdf.md')).toBe('doc.pdf')
    })
    test('case-insensitive: PHOTO.PNG.md still resolves', () => {
        expect(binaryForCompanion('PHOTO.PNG.md')).toBe('PHOTO.PNG')
    })
    test('a double .md ("x.png.md.md") is not a companion — its stripped path is not companionable', () => {
        expect(binaryForCompanion('x.png.md.md')).toBeNull()
    })
    test('a plain note is not a companion', () => {
        expect(binaryForCompanion('notes.md')).toBeNull()
    })
    test('a dotfile is never a companion', () => {
        expect(binaryForCompanion('.gitignore')).toBeNull()
    })
    test('a no-ext path is never a companion', () => {
        expect(binaryForCompanion('README')).toBeNull()
    })
    test('a non-.md path returns null outright', () => {
        expect(binaryForCompanion('a/x.png')).toBeNull()
        expect(binaryForCompanion('a/x.png.draw')).toBeNull()
    })
})

describe('isTreeListedName', () => {
    test('vault-native editable formats', () => {
        for (const n of [
            'Note.md',
            'Sketch.draw',
            'Budget.sheet',
            'c.yaml',
            'c.yml',
        ]) {
            expect(isTreeListedName(n)).toBe(true)
        }
    })
    test('every companionable binary is listed', () => {
        expect(isTreeListedName('photo.png')).toBe(true)
        expect(isTreeListedName('scan.heic')).toBe(true)
        expect(isTreeListedName('doc.pdf')).toBe(true)
    })
    test('unsupported extensions are not listed', () => {
        expect(isTreeListedName('song.mp3')).toBe(false)
        expect(isTreeListedName('archive.zip')).toBe(false)
        expect(isTreeListedName('README')).toBe(false)
    })
})
