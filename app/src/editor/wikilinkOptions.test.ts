// app/src/editor/wikilinkOptions.test.ts
import { test, expect } from 'bun:test'
import { wikilinkOptions } from './wikilinkOptions'
import { linkTargetFor } from '../../../core/src/linkTarget'
import type { NoteCandidate } from './wikilink'

test('wikilinkOptions: unique note gets a bare basename target + its dir as detail', () => {
    const notes: NoteCandidate[] = [
        { label: 'Solo', path: 'notes/Solo' },
    ]
    expect(wikilinkOptions(notes)).toEqual([
        { label: 'Solo', detail: 'notes', target: 'Solo' },
    ])
})

test('wikilinkOptions: two notes sharing a basename in different dirs both get full-path targets + distinct details', () => {
    const notes: NoteCandidate[] = [
        { label: 'Plan', path: 'Projects/Alpha/Plan' },
        { label: 'Plan', path: 'Archive/Plan' },
    ]
    const options = wikilinkOptions(notes)
    expect(options).toEqual([
        { label: 'Plan', detail: 'Projects/Alpha', target: 'Projects/Alpha/Plan' },
        { label: 'Plan', detail: 'Archive', target: 'Archive/Plan' },
    ])
})

test('wikilinkOptions: a root note (no folder) gets an empty-string detail', () => {
    const notes: NoteCandidate[] = [{ label: 'Root', path: 'Root' }]
    expect(wikilinkOptions(notes)).toEqual([
        { label: 'Root', detail: '', target: 'Root' },
    ])
})

test('wikilinkOptions: target matches linkTargetFor for every note, over a mixed set', () => {
    const notes: NoteCandidate[] = [
        { label: 'Plan', path: 'Projects/Alpha/Plan' },
        { label: 'Plan', path: 'Archive/Plan' },
        { label: 'Solo', path: 'notes/Solo' },
        { label: 'Root', path: 'Root' },
    ]
    const ids = notes.map(n => n.path)
    const options = wikilinkOptions(notes)
    options.forEach((o, i) => {
        expect(o.target).toBe(linkTargetFor(notes[i].path, ids))
    })
})
