import { describe, expect, test } from 'bun:test'
import {
    checkedLevel,
    deleteAllLabel,
    deletedChatsMessage,
    effectiveNote,
    isDeleteKeyForRow,
    levelToWrite,
    resolveVisibility,
} from './chatVisibility'

describe('levelToWrite', () => {
    test('Visible clears the entry under an open default', () => {
        expect(levelToWrite('all', 'all')).toBeNull()
    })
    test('Visible writes an explicit all under a restricting default', () => {
        expect(levelToWrite('all', 'hidden')).toBe('all')
        expect(levelToWrite('all', 'chat-only')).toBe('all')
    })
    test('restricting picks always write themselves', () => {
        expect(levelToWrite('hidden', 'all')).toBe('hidden')
        expect(levelToWrite('chat-only', 'hidden')).toBe('chat-only')
    })
})

describe('checkedLevel', () => {
    test('own entry wins', () => {
        expect(checkedLevel('chat-only', 'hidden')).toBe('chat-only')
        expect(checkedLevel('all', 'hidden')).toBe('all')
    })
    test('inheriting an open default checks Visible', () => {
        expect(checkedLevel(undefined, 'all')).toBe('all')
    })
    test('inheriting a restricting default checks nothing', () => {
        expect(checkedLevel(undefined, 'hidden')).toBeNull()
    })
})

describe('effectiveNote', () => {
    test('names the inherited restriction', () => {
        expect(effectiveNote(undefined, 'hidden')).toBe(
            'Effective: Hidden — inherited from the chat default',
        )
        expect(effectiveNote(undefined, 'chat-only')).toBe(
            'Effective: Chat only — inherited from the chat default',
        )
    })
    test('absent with an own level or an open default', () => {
        expect(effectiveNote('all', 'hidden')).toBeNull()
        expect(effectiveNote(undefined, 'all')).toBeNull()
    })
})

describe('delete copy', () => {
    test('labels by scope', () => {
        expect(deleteAllLabel('daemon')).toBe('Delete all daemon chats')
        expect(deleteAllLabel('user')).toBe('Delete all your chats')
        expect(deleteAllLabel('all')).toBe('Delete every chat')
    })
    test('the undo toast names one chat or counts several', () => {
        expect(deletedChatsMessage(1, 'draft the grant budget')).toBe(
            'deleted chat: draft the grant budget',
        )
        expect(deletedChatsMessage(1, '  ')).toBe('deleted chat: untitled session')
        expect(deletedChatsMessage(12)).toBe('deleted 12 chats')
    })
})

describe('isDeleteKeyForRow', () => {
    test('needs a matching key and a live cursor row', () => {
        expect(isDeleteKeyForRow(true, 2)).toBe(true)
        expect(isDeleteKeyForRow(true, -1)).toBe(false)
        expect(isDeleteKeyForRow(false, 2)).toBe(false)
    })
})

describe('resolveVisibility', () => {
    test('own entry beats the default; all is omitted', () => {
        expect(resolveVisibility('all', 'hidden')).toBeUndefined()
        expect(resolveVisibility('chat-only', 'all')).toBe('chat-only')
        expect(resolveVisibility(undefined, 'hidden')).toBe('hidden')
        expect(resolveVisibility(undefined, 'all')).toBeUndefined()
    })
})
