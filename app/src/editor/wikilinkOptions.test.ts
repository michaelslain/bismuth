// app/src/editor/wikilinkOptions.test.ts
import { test, expect } from 'bun:test'
import { wikilinkOptions } from './wikilinkOptions'
import { baseOf, linkTargetFor } from '../../../core/src/linkTarget'
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

// A `.markdown` note keeps its extension in the id (noteId only strips `.md`), so its
// `label` (the bare display basename) diverges from `baseOf(path)`. Counting/targeting by
// `label` instead of `baseOf(path)` would miss this duplicate entirely.
test('wikilinkOptions: counts and targets by baseOf(path), not label, when they diverge', () => {
    const notes: NoteCandidate[] = [
        { label: 'Notes', path: 'a/Notes.markdown' },
        { label: 'Notes.markdown', path: 'b/Notes.markdown' },
    ]
    const ids = notes.map(n => n.path)
    const options = wikilinkOptions(notes)
    expect(options).toEqual([
        { label: 'Notes', detail: 'a', target: 'a/Notes.markdown' },
        { label: 'Notes.markdown', detail: 'b', target: 'b/Notes.markdown' },
    ])
    options.forEach((o, i) => {
        expect(o.target).toBe(linkTargetFor(notes[i].path, ids))
        expect(baseOf(notes[i].path)).toBe('Notes.markdown')
    })
})
