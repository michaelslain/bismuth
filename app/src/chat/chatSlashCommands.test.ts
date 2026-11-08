// app/src/chatSlashCommands.test.ts
import { describe, it, expect } from 'bun:test'
import {
    parseChatSlashCommand,
    CLIENT_SLASH_COMMANDS,
    withClientSlashCommands,
    matchSlashCommands,
    slashArgHint,
} from './chatSlashCommands'

describe('parseChatSlashCommand', () => {
    it('parses `/rename <name>`', () => {
        expect(parseChatSlashCommand('/rename Planning')).toEqual({
            kind: 'rename',
            name: 'Planning',
        })
    })
    it('keeps a multi-word rename name', () => {
        expect(parseChatSlashCommand('/rename Q3 Planning Sync')).toEqual({
            kind: 'rename',
            name: 'Q3 Planning Sync',
        })
    })
    it('`/rename` with no arg → empty name (caller reverts to auto label)', () => {
        expect(parseChatSlashCommand('/rename')).toEqual({
            kind: 'rename',
            name: '',
        })
    })
    it('parses `/color <token>` keeping the raw arg (caller resolves it)', () => {
        expect(parseChatSlashCommand('/color blue')).toEqual({
            kind: 'color',
            arg: 'blue',
        })
        expect(parseChatSlashCommand('/color #ffcc00')).toEqual({
            kind: 'color',
            arg: '#ffcc00',
        })
    })
    it('`/colour` (British spelling) also parses as color', () => {
        expect(parseChatSlashCommand('/colour green')).toEqual({
            kind: 'color',
            arg: 'green',
        })
    })
    it('is case-insensitive on the command word', () => {
        expect(parseChatSlashCommand('/RENAME Foo')).toEqual({
            kind: 'rename',
            name: 'Foo',
        })
    })
    it('trims surrounding whitespace', () => {
        expect(parseChatSlashCommand('  /rename  Foo  ')).toEqual({
            kind: 'rename',
            name: 'Foo',
        })
    })
    it('returns null for a non-local command (falls through to the model)', () => {
        expect(parseChatSlashCommand('/compact')).toBeNull()
        expect(parseChatSlashCommand('/mcp')).toBeNull()
    })
    it('returns null for plain prose', () => {
        expect(parseChatSlashCommand('rename this chat please')).toBeNull()
        expect(parseChatSlashCommand('')).toBeNull()
    })
})

// BUG #87 ("/chrome command missing"): the "/" autocomplete popover used to be built ONLY from the
// backend's manifest.slashCommands, which never lists these client-side commands — so a client
// command never appeared in the picker even though parseChatSlashCommand understood it fine. These
// tests cover the list ChatView splices in (withClientSlashCommands) rather than the DOM popover
// itself.
describe('CLIENT_SLASH_COMMANDS / withClientSlashCommands (BUG #87 autocomplete fix)', () => {
    it('lists rename and color with a non-empty detail and argument hint each', () => {
        const names = CLIENT_SLASH_COMMANDS.map(c => c.name)
        expect(names).toEqual(['rename', 'color'])
        for (const c of CLIENT_SLASH_COMMANDS) {
            expect(c.detail.length).toBeGreaterThan(0)
            expect(c.hint.length).toBeGreaterThan(0)
        }
    })

    it('appends the client commands to an empty (pre-manifest) list', () => {
        expect(withClientSlashCommands([])).toEqual(['rename', 'color'])
    })

    it("appends after the backend's own commands, preserving their order", () => {
        expect(withClientSlashCommands(['compact', 'mcp'])).toEqual([
            'compact',
            'mcp',
            'rename',
            'color',
        ])
    })

    it("dedupes: a backend command sharing a client command's name isn't duplicated", () => {
        expect(withClientSlashCommands(['color'])).toEqual([
            'color',
            'rename',
        ])
    })
})

describe('matchSlashCommands', () => {
    const cmds = [
        'compact',
        'clear',
        'superpowers:brainstorming',
        'code-review',
        'bust',
        'review',
        'cobrain',
    ]
    it('offers every command for an empty query, in list order', () => {
        expect(matchSlashCommands(cmds, '')).toEqual(cmds)
    })
    it('ranks a name prefix first, then a later part prefix, then a substring', () => {
        expect(matchSlashCommands(cmds, 'brain')).toEqual([
            'superpowers:brainstorming',
            'cobrain',
        ])
        expect(matchSlashCommands(cmds, 'review')).toEqual([
            'review',
            'code-review',
        ])
    })
    it('keeps list order within a group', () => {
        expect(matchSlashCommands(cmds, 'c')).toEqual([
            'compact',
            'clear',
            'code-review',
            'cobrain',
        ])
        expect(matchSlashCommands(cmds, 'st')).toEqual([
            'superpowers:brainstorming',
            'bust',
        ])
    })
    it('matches case-insensitively and caps the list', () => {
        expect(matchSlashCommands(['Bust', 'bustle'], 'BU', 1)).toEqual([
            'Bust',
        ])
    })
    it('offers a name listed twice once', () => {
        expect(matchSlashCommands(['code-review', 'clear', 'code-review'], 'co')).toEqual([
            'code-review',
        ])
    })
    it('returns nothing when no name contains the query', () => {
        expect(matchSlashCommands(cmds, 'zzz')).toEqual([])
    })
})

describe('slashArgHint', () => {
    const hints: Record<string, string> = { bust: '[deep] [K] <goal>' }
    const hintFor = (n: string) => hints[n]
    it('shows once the command is followed by a space and nothing else', () => {
        expect(slashArgHint('/bust ', hintFor)).toBe('[deep] [K] <goal>')
        expect(slashArgHint('/bust   ', hintFor)).toBe('[deep] [K] <goal>')
    })
    it('hides while the command is still being typed, and once an argument starts', () => {
        expect(slashArgHint('/bust', hintFor)).toBeUndefined()
        expect(slashArgHint('/bust d', hintFor)).toBeUndefined()
        expect(slashArgHint('/bust \n', hintFor)).toBeUndefined()
    })
    it('hides for a command with no hint and for prose', () => {
        expect(slashArgHint('/clear ', hintFor)).toBeUndefined()
        expect(slashArgHint('hello ', hintFor)).toBeUndefined()
    })
})
