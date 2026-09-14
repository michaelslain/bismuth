// app/src/dnd/noteRef.test.ts
import { describe, it, expect } from 'bun:test'
import {
    isMarkdown,
    noteNameFromPath,
    wikilinkFor,
    descriptorMovePath,
    descriptorNotePath,
    descriptorEmbedPath,
    embedFor,
    descriptorChatRefPath,
    isChatReferenceDrop,
} from './noteRef'
import { CHAT_PREFIX } from '../tabIds'
import type { DragDescriptor } from './viewDrag'

describe('isMarkdown', () => {
    it('accepts .md / .markdown case-insensitively', () => {
        expect(isMarkdown('Beta.md')).toBe(true)
        expect(isMarkdown('Notes/Deep/Thing.MD')).toBe(true)
        expect(isMarkdown('readme.markdown')).toBe(true)
    })
    it('rejects non-markdown files and folders', () => {
        expect(isMarkdown('Budget.sheet')).toBe(false)
        expect(isMarkdown('Sketch.draw')).toBe(false)
        expect(isMarkdown('Projects')).toBe(false)
        expect(isMarkdown('notes.md.bak')).toBe(false)
    })
})

describe('noteNameFromPath', () => {
    it('strips folders and the markdown extension (wikilinks resolve by filename)', () => {
        expect(noteNameFromPath('Projects/Gamma.md')).toBe('Gamma')
        expect(noteNameFromPath('Beta.md')).toBe('Beta')
        expect(noteNameFromPath('a/b/c/Deep Note.markdown')).toBe('Deep Note')
    })
    it('keeps a non-markdown basename intact', () => {
        expect(noteNameFromPath('Budget.sheet')).toBe('Budget.sheet')
    })
})

describe('wikilinkFor', () => {
    it('wraps the note name in [[ ]]', () => {
        expect(wikilinkFor('Projects/Gamma.md')).toBe('[[Gamma]]')
        expect(wikilinkFor('Beta.md')).toBe('[[Beta]]')
    })
})

const note = (path: string): DragDescriptor => ({
    kind: 'note',
    path,
    label: path,
    width: 10,
})
const folder = (path: string): DragDescriptor => ({
    kind: 'folder',
    path,
    label: path,
    width: 10,
})
const tab = (path?: string): DragDescriptor => ({
    kind: 'tab',
    tabId: 't1',
    label: 'T',
    width: 10,
    path,
})
const pane = (path?: string): DragDescriptor => ({
    kind: 'pane',
    tabId: 't1',
    leafId: 'l1',
    label: 'P',
    width: 10,
    path,
})

describe('descriptorMovePath', () => {
    it('returns the path for notes, folders, and path-backed tabs/panes', () => {
        expect(descriptorMovePath(note('Beta.md'))).toBe('Beta.md')
        expect(descriptorMovePath(folder('Archive'))).toBe('Archive')
        expect(descriptorMovePath(tab('Beta.md'))).toBe('Beta.md')
        expect(descriptorMovePath(pane('x/Gamma.md'))).toBe('x/Gamma.md')
    })
    it('returns null for a pathless tab/pane (chat/terminal/graph) and for null', () => {
        expect(descriptorMovePath(tab(undefined))).toBeNull()
        expect(descriptorMovePath(pane(undefined))).toBeNull()
        expect(descriptorMovePath(null)).toBeNull()
    })
})

describe('descriptorNotePath', () => {
    it('returns a markdown note path from notes and note-backed tabs/panes', () => {
        expect(descriptorNotePath(note('Beta.md'))).toBe('Beta.md')
        expect(descriptorNotePath(tab('Projects/Gamma.md'))).toBe(
            'Projects/Gamma.md',
        )
        expect(descriptorNotePath(pane('Beta.md'))).toBe('Beta.md')
    })
    it('returns null for folders, non-markdown files, and pathless descriptors', () => {
        expect(descriptorNotePath(folder('Archive'))).toBeNull()
        expect(descriptorNotePath(note('Budget.sheet'))).toBeNull()
        expect(descriptorNotePath(tab(undefined))).toBeNull()
        expect(descriptorNotePath(null)).toBeNull()
    })
})

// Row 79b: a chat reference accepts ANY file/folder, unlike the markdown-only editor wikilink drop.
describe('descriptorChatRefPath', () => {
    it('returns the path for notes, folders, non-markdown files, and path-backed tabs/panes', () => {
        expect(descriptorChatRefPath(note('Beta.md'))).toBe('Beta.md')
        expect(descriptorChatRefPath(note('assets/diagram.png'))).toBe(
            'assets/diagram.png',
        )
        expect(descriptorChatRefPath(folder('Archive'))).toBe('Archive')
        expect(descriptorChatRefPath(tab('Budget.sheet'))).toBe('Budget.sheet')
        expect(descriptorChatRefPath(pane('x/Gamma.md'))).toBe('x/Gamma.md')
    })
    it('returns null for a pathless tab/pane and null', () => {
        expect(descriptorChatRefPath(tab(undefined))).toBeNull()
        expect(descriptorChatRefPath(null)).toBeNull()
    })
    // Locks in that a tree image/PDF dropped on a chat already resolves to a referenceable
    // sidebar path — tree -> chat needed no new code (App.tsx's referenceOnPane just calls this),
    // but nothing pinned it down before Task 3 added the note-embed variant (descriptorEmbedPath)
    // alongside it.
    it('resolves a .png/.pdf sidebar path (tree -> chat reference)', () => {
        expect(descriptorChatRefPath(note('assets/diagram.png'))).toBe(
            'assets/diagram.png',
        )
        expect(descriptorChatRefPath(note('reports/summary.pdf'))).toBe(
            'reports/summary.pdf',
        )
    })
})

// Row 74's binary-drop variant: a tree image/PDF dropped on a note's center embeds it.
describe('descriptorEmbedPath', () => {
    it('returns the path for an image or pdf file, from a note or a path-backed tab/pane', () => {
        expect(descriptorEmbedPath(note('assets/diagram.png'))).toBe(
            'assets/diagram.png',
        )
        expect(descriptorEmbedPath(note('reports/summary.pdf'))).toBe(
            'reports/summary.pdf',
        )
        expect(descriptorEmbedPath(tab('assets/photo.JPG'))).toBe(
            'assets/photo.JPG',
        )
    })
    it('returns null for markdown notes, folders, other file kinds, and pathless descriptors', () => {
        expect(descriptorEmbedPath(note('Beta.md'))).toBeNull()
        expect(descriptorEmbedPath(folder('assets'))).toBeNull()
        expect(descriptorEmbedPath(note('Budget.sheet'))).toBeNull()
        expect(descriptorEmbedPath(tab(undefined))).toBeNull()
        expect(descriptorEmbedPath(null)).toBeNull()
    })
})

describe('embedFor', () => {
    it('wraps the basename, WITH its extension, in ![[ ]]', () => {
        expect(embedFor('assets/diagram.png')).toBe('![[diagram.png]]')
        expect(embedFor('reports/summary.pdf')).toBe('![[summary.pdf]]')
        expect(embedFor('photo.jpg')).toBe('![[photo.jpg]]')
    })
})

// Row 74: the shared predicate driving BOTH the drop handler and the split-highlight suppression.
describe('isChatReferenceDrop', () => {
    const chat = CHAT_PREFIX + 'abc'
    it('true for a chat pane + a referenceable payload (note, non-md file, folder, path-backed tab)', () => {
        expect(isChatReferenceDrop(chat, note('Beta.md'))).toBe(true)
        expect(isChatReferenceDrop(chat, note('assets/pic.png'))).toBe(true)
        expect(isChatReferenceDrop(chat, folder('Archive'))).toBe(true)
        expect(isChatReferenceDrop(chat, tab('Beta.md'))).toBe(true)
    })
    it("false when the pane isn't a chat (a note/base pane still splits)", () => {
        expect(isChatReferenceDrop('Notes.md', note('Beta.md'))).toBe(false)
        expect(isChatReferenceDrop('::graph', note('Beta.md'))).toBe(false)
    })
    it('false when the payload carries no vault path (a chat/terminal tab dragged onto a chat)', () => {
        expect(isChatReferenceDrop(chat, tab(undefined))).toBe(false)
        expect(isChatReferenceDrop(chat, null)).toBe(false)
    })
    it('false for an undefined pane content', () => {
        expect(isChatReferenceDrop(undefined, note('Beta.md'))).toBe(false)
    })
})
