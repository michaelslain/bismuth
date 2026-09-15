// app/src/preview/pdfViewMemory.test.ts
import { describe, expect, test } from 'bun:test'
import {
    clearPdfView,
    loadPdfView,
    renamePdfView,
    savePdfView,
} from './pdfViewMemory'

describe('pdfViewMemory', () => {
    test('loadPdfView returns undefined for a path nothing was saved under', () => {
        expect(loadPdfView('never.pdf')).toBeUndefined()
    })

    test('savePdfView creates a default state and merges the patch', () => {
        savePdfView('a.pdf', { zoom: 1.5 })
        expect(loadPdfView('a.pdf')).toEqual({ zoom: 1.5, panelOpen: false })
    })

    test('a later savePdfView patch merges onto the existing state', () => {
        savePdfView('merge.pdf', { zoom: 1.5 })
        savePdfView('merge.pdf', {
            position: { index: 4, yFraction: 0.25, xFraction: 0 },
        })
        expect(loadPdfView('merge.pdf')).toEqual({
            zoom: 1.5,
            panelOpen: false,
            position: { index: 4, yFraction: 0.25, xFraction: 0 },
        })
    })

    test('renamePdfView moves the stored state to the new path', () => {
        savePdfView('old.pdf', { zoom: 2 })
        renamePdfView('old.pdf', 'new.pdf')
        expect(loadPdfView('old.pdf')).toBeUndefined()
        expect(loadPdfView('new.pdf')).toEqual({ zoom: 2, panelOpen: false })
    })

    test('clearPdfView forgets the stored state', () => {
        savePdfView('clear.pdf', { zoom: 3 })
        clearPdfView('clear.pdf')
        expect(loadPdfView('clear.pdf')).toBeUndefined()
    })

    test('renaming a path with nothing stored is a no-op', () => {
        renamePdfView('nothing-here.pdf', 'still-nothing.pdf')
        expect(loadPdfView('still-nothing.pdf')).toBeUndefined()
    })
})
