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
    isEditorReferenceDrop,
    usesReferenceGeometry,
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
    it('wraps the bare basename when no other id shares it', () => {
        expect(wikilinkFor('Projects/Gamma.md', ['Projects/Gamma', 'Beta'])).toBe(
            '[[Gamma]]',
        )
        expect(wikilinkFor('Beta.md', ['Projects/Gamma', 'Beta'])).toBe('[[Beta]]')
    })
    it('path-qualifies when another id shares the basename', () => {
        expect(
            wikilinkFor('Projects/Gamma.md', ['Projects/Gamma', 'Archive/Gamma']),
        ).toBe('[[Projects/Gamma]]')
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
    it('wraps the basename, WITH its extension, in ![[ ]], when no other path shares it', () => {
        expect(embedFor('assets/diagram.png', ['assets/diagram.png', 'y/b.png'])).toBe(
            '![[diagram.png]]',
        )
        expect(
            embedFor('reports/summary.pdf', ['reports/summary.pdf']),
        ).toBe('![[summary.pdf]]')
        expect(embedFor('photo.jpg', ['photo.jpg'])).toBe('![[photo.jpg]]')
    })
    it('path-qualifies when another file shares the basename', () => {
        expect(
            embedFor('x/diagram.png', ['x/diagram.png', 'y/diagram.png']),
        ).toBe('![[x/diagram.png]]')
    })
    it('does not treat different extensions as duplicates', () => {
        expect(
            embedFor('x/diagram.png', ['x/diagram.png', 'x/diagram.pdf']),
        ).toBe('![[diagram.png]]')
    })
    it('a root-level file stays ambiguous by basename against a nested twin, but resolves exact', () => {
        expect(
            embedFor('diagram.png', ['diagram.png', 'x/diagram.png']),
        ).toBe('![[diagram.png]]')
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

describe('isEditorReferenceDrop', () => {
    it('true for a note dropped in the center of another note with a live editor', () => {
        expect(
            isEditorReferenceDrop('Alpha.md', note('Beta.md'), 'center', true),
        ).toBe(true)
    })
    it('false when dropped onto its own pane', () => {
        expect(
            isEditorReferenceDrop('Beta.md', note('Beta.md'), 'center', true),
        ).toBe(false)
    })
    it('false for a folder payload', () => {
        expect(
            isEditorReferenceDrop('Alpha.md', folder('Archive'), 'center', true),
        ).toBe(false)
    })
    it('true for an image/pdf dropped onto a note center (embed)', () => {
        expect(
            isEditorReferenceDrop(
                'Alpha.md',
                note('assets/pic.png'),
                'center',
                true,
            ),
        ).toBe(true)
    })
    it('false when the pane is not markdown (.sheet, ::graph)', () => {
        expect(
            isEditorReferenceDrop('Budget.sheet', note('Beta.md'), 'center', true),
        ).toBe(false)
        expect(
            isEditorReferenceDrop('::graph', note('Beta.md'), 'center', true),
        ).toBe(false)
    })
    it('false outside the center zone', () => {
        expect(
            isEditorReferenceDrop('Alpha.md', note('Beta.md'), 'left', true),
        ).toBe(false)
    })
    it('false when the pane has no live editor (a base pane rendering a .md file)', () => {
        expect(
            isEditorReferenceDrop('Alpha.md', note('Beta.md'), 'center', false),
        ).toBe(false)
    })
})

describe('usesReferenceGeometry', () => {
    it('true for a sidebar note row over a pane with a live editor', () => {
        expect(usesReferenceGeometry(note('Beta.md'), true)).toBe(true)
        expect(usesReferenceGeometry(note('assets/pic.png'), true)).toBe(true)
    })
    it('false for a sidebar note row when the pane has no live editor', () => {
        expect(usesReferenceGeometry(note('Beta.md'), false)).toBe(false)
    })
    it('false for a tab or pane descriptor, even over a live editor (Row 74 unchanged, no regression on pane rearranging)', () => {
        expect(usesReferenceGeometry(tab('Beta.md'), true)).toBe(false)
        expect(usesReferenceGeometry(pane('Beta.md'), true)).toBe(false)
    })
    it('false for a folder', () => {
        expect(usesReferenceGeometry(folder('Archive'), true)).toBe(false)
    })
    it('false for a non-referenceable note (no markdown/image/pdf payload) or null', () => {
        expect(usesReferenceGeometry(note('Budget.sheet'), true)).toBe(false)
        expect(usesReferenceGeometry(null, true)).toBe(false)
    })
})
