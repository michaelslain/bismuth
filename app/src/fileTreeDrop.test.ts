// app/src/fileTreeDrop.test.ts
import { describe, it, expect } from 'bun:test'
import { planTreeUploads, dropFolderFromAttrs } from './fileTreeDrop'

describe('planTreeUploads', () => {
    it('targets the vault root when targetDir is empty', () => {
        const plan = planTreeUploads('', ['photo.png'])
        expect(plan.accepted).toEqual([
            { name: 'photo.png', target: 'photo.png', convertHeic: false },
        ])
        expect(plan.rejected).toEqual([])
    })

    it('targets a folder path', () => {
        const plan = planTreeUploads('attachments', ['photo.png'])
        expect(plan.accepted).toEqual([
            {
                name: 'photo.png',
                target: 'attachments/photo.png',
                convertHeic: false,
            },
        ])
    })

    it('targets a nested folder path', () => {
        const plan = planTreeUploads('projects/2026/q1', ['diagram.pdf'])
        expect(plan.accepted).toEqual([
            {
                name: 'diagram.pdf',
                target: 'projects/2026/q1/diagram.pdf',
                convertHeic: false,
            },
        ])
    })

    it('renames a HEIC/HEIF drop to .jpg and flags conversion', () => {
        const plan = planTreeUploads('', ['IMG_0001.HEIC', 'IMG_0002.heif'])
        expect(plan.accepted).toEqual([
            {
                name: 'IMG_0001.HEIC',
                target: 'IMG_0001.jpg',
                convertHeic: true,
            },
            {
                name: 'IMG_0002.heif',
                target: 'IMG_0002.jpg',
                convertHeic: true,
            },
        ])
    })

    it('rejects a type the tree does not list, keeping its original name', () => {
        const plan = planTreeUploads('', ['archive.zip'])
        expect(plan.accepted).toEqual([])
        expect(plan.rejected).toEqual(['archive.zip'])
    })

    it('keeps a name with spaces intact in both name and target', () => {
        const plan = planTreeUploads('My Folder', ['Vacation Photo.jpg'])
        expect(plan.accepted).toEqual([
            {
                name: 'Vacation Photo.jpg',
                target: 'My Folder/Vacation Photo.jpg',
                convertHeic: false,
            },
        ])
    })

    it('splits a mixed batch into accepted (in order) and rejected (by original name)', () => {
        const plan = planTreeUploads('', [
            'a.png',
            'b.zip',
            'c.pdf',
            'notes.txt',
        ])
        expect(plan.accepted.map(a => a.name)).toEqual(['a.png', 'c.pdf'])
        expect(plan.rejected).toEqual(['b.zip', 'notes.txt'])
    })
})

describe('dropFolderFromAttrs', () => {
    it('returns the folder path when dropFolder is set', () => {
        expect(dropFolderFromAttrs({ dropFolder: 'projects' })).toBe('projects')
    })

    it("returns '' for the tree root", () => {
        expect(dropFolderFromAttrs({ dropRoot: 'true' })).toBe('')
    })

    it('prefers dropFolder over dropRoot when both are somehow present', () => {
        expect(dropFolderFromAttrs({ dropFolder: 'x', dropRoot: 'true' })).toBe(
            'x',
        )
    })

    it('returns null when neither attribute is present', () => {
        expect(dropFolderFromAttrs({})).toBeNull()
        expect(
            dropFolderFromAttrs({ dropFolder: null, dropRoot: null }),
        ).toBeNull()
    })
})
