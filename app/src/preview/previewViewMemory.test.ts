// app/src/preview/previewViewMemory.test.ts
import { describe, expect, test } from 'bun:test'
import {
    clearPreviewView,
    loadPreviewView,
    renamePreviewView,
    savePreviewView,
    attachPreviewViewStorage,
    flushPreviewView,
    PREVIEW_VIEW_CAP,
    WRITE_DELAY_MS,
    type PreviewViewState,
} from './previewViewMemory'

describe('previewViewMemory', () => {
    test('loadPreviewView returns undefined for a path nothing was saved under', () => {
        expect(loadPreviewView('never.pdf')).toBeUndefined()
    })

    test('savePreviewView creates a default state and merges the patch', () => {
        savePreviewView('a.pdf', { zoom: 1.5 })
        expect(loadPreviewView('a.pdf')).toEqual({
            zoom: 1.5,
            panelOpen: false,
        })
    })

    test('a later savePreviewView patch merges onto the existing state', () => {
        savePreviewView('merge.pdf', { zoom: 1.5 })
        savePreviewView('merge.pdf', {
            position: { index: 4, yFraction: 0.25, xFraction: 0 },
        })
        expect(loadPreviewView('merge.pdf')).toEqual({
            zoom: 1.5,
            panelOpen: false,
            position: { index: 4, yFraction: 0.25, xFraction: 0 },
        })
    })

    test('renamePreviewView moves the stored state to the new path', () => {
        savePreviewView('old.pdf', { zoom: 2 })
        renamePreviewView('old.pdf', 'new.pdf')
        expect(loadPreviewView('old.pdf')).toBeUndefined()
        expect(loadPreviewView('new.pdf')).toEqual({
            zoom: 2,
            panelOpen: false,
        })
    })

    test('clearPreviewView forgets the stored state', () => {
        savePreviewView('clear.pdf', { zoom: 3 })
        clearPreviewView('clear.pdf')
        expect(loadPreviewView('clear.pdf')).toBeUndefined()
    })

    test('renaming a path with nothing stored is a no-op', () => {
        renamePreviewView('nothing-here.pdf', 'still-nothing.pdf')
        expect(loadPreviewView('still-nothing.pdf')).toBeUndefined()
    })
})

describe('previewViewMemory storage', () => {
    const backing = (initial: unknown) => {
        const box = { stored: initial as unknown, writes: 0 }
        return {
            box,
            storage: {
                read: () => box.stored,
                write: (entries: [string, PreviewViewState][]) => {
                    box.stored = entries
                    box.writes++
                },
            },
        }
    }

    test('attaching storage loads what a previous session saved', () => {
        const { storage } = backing([
            [
                'stored.pdf',
                {
                    zoom: 2,
                    panelOpen: true,
                    position: { index: 7, yFraction: 0.5, xFraction: 0 },
                },
            ],
            [
                'stored.png',
                {
                    zoom: 3,
                    panelOpen: false,
                    image: { zoom: 3, fx: 0.25, fy: 0.75 },
                },
            ],
        ])
        attachPreviewViewStorage(storage)
        expect(loadPreviewView('stored.pdf')?.position).toEqual({
            index: 7,
            yFraction: 0.5,
            xFraction: 0,
        })
        expect(loadPreviewView('stored.png')?.image).toEqual({
            zoom: 3,
            fx: 0.25,
            fy: 0.75,
        })
    })

    test('malformed stored entries are dropped, well-formed ones kept', () => {
        const { storage } = backing([
            'junk',
            ['bad-zoom.pdf', { zoom: 'x', panelOpen: false }],
            [
                'bad-pos.pdf',
                { zoom: 1, panelOpen: false, position: { index: 'a' } },
            ],
            ['ok.pdf', { zoom: 1.5, panelOpen: false }],
        ])
        attachPreviewViewStorage(storage)
        expect(loadPreviewView('bad-zoom.pdf')).toBeUndefined()
        expect(loadPreviewView('bad-pos.pdf')).toEqual({
            zoom: 1,
            panelOpen: false,
        })
        expect(loadPreviewView('ok.pdf')).toEqual({
            zoom: 1.5,
            panelOpen: false,
        })
    })

    test('a path saved this session keeps its newer state over the stored one', () => {
        savePreviewView('live.pdf', { zoom: 4 })
        const { storage } = backing([
            ['live.pdf', { zoom: 1, panelOpen: false }],
        ])
        attachPreviewViewStorage(storage)
        expect(loadPreviewView('live.pdf')?.zoom).toBe(4)
    })

    test('saves are written back to storage once the burst settles', async () => {
        const { box, storage } = backing([])
        attachPreviewViewStorage(storage)
        const before = box.writes
        savePreviewView('burst.pdf', {
            position: { index: 1, yFraction: 0, xFraction: 0 },
        })
        savePreviewView('burst.pdf', {
            position: { index: 2, yFraction: 0, xFraction: 0 },
        })
        expect(box.writes).toBe(before)
        await new Promise(r => setTimeout(r, WRITE_DELAY_MS + 50))
        expect(box.writes).toBe(before + 1)
        const entry = (box.stored as [string, PreviewViewState][]).find(
            ([k]) => k === 'burst.pdf',
        )
        expect(entry?.[1].position?.index).toBe(2)
    })

    test('flushPreviewView writes at once, and the reloaded memory restores the position', () => {
        const { box, storage } = backing([])
        attachPreviewViewStorage(storage)
        savePreviewView('reload.pdf', {
            position: { index: 9, yFraction: 0.1, xFraction: 0 },
        })
        flushPreviewView()
        clearPreviewView('reload.pdf')
        flushPreviewView()
        expect(loadPreviewView('reload.pdf')).toBeUndefined()
        savePreviewView('reload.pdf', {
            position: { index: 9, yFraction: 0.1, xFraction: 0 },
        })
        flushPreviewView()
        const stored = box.stored
        attachPreviewViewStorage({ read: () => stored, write: () => {} })
        expect(loadPreviewView('reload.pdf')?.position?.index).toBe(9)
    })

    test('past the cap the least recently saved path is dropped', () => {
        attachPreviewViewStorage(backing([]).storage)
        savePreviewView('first.pdf', { zoom: 2 })
        for (let i = 0; i < PREVIEW_VIEW_CAP; i++)
            savePreviewView(`fill-${i}.pdf`, { zoom: 1 })
        expect(loadPreviewView('first.pdf')).toBeUndefined()
        expect(
            loadPreviewView(`fill-${PREVIEW_VIEW_CAP - 1}.pdf`),
        ).toBeDefined()
    })
})
