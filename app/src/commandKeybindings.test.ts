import { describe, expect, it } from 'bun:test'
import { keybindingForCommand, KEYED_COMMAND_IDS } from './commandKeybindings'
import { KEYBINDING_CATALOG } from '../../core/src/keybindings'
import { COMMAND_IDS } from '../../core/src/commands'

describe('keybindingForCommand', () => {
    it('pins the exact set of commands that a global key also runs', () => {
        expect([...KEYED_COMMAND_IDS].sort()).toEqual(
            [
                'close-pane',
                'equalize-panes',
                'export',
                'focus-pane-down',
                'focus-pane-left',
                'focus-pane-right',
                'focus-pane-up',
                'history-back',
                'history-forward',
                'new-claude-chat',
                'new-tab',
                'new-window',
                'open-folder',
                'quick-ask',
                'reopen-tab',
                'split-down',
                'split-right',
                'terminal',
                'toggle-sidebar',
                'toggle-tab-rail',
                'zoom-in',
                'zoom-out',
                'zoom-reset',
            ].sort(),
        )
    })

    it('maps a command to the key of the same name', () => {
        expect(keybindingForCommand('toggle-sidebar')).toBe('toggle-sidebar')
        expect(keybindingForCommand('terminal')).toBe('terminal')
    })

    it('returns undefined for a command with no key', () => {
        expect(keybindingForCommand('open-graph')).toBeUndefined()
        expect(keybindingForCommand('search')).toBeUndefined()
        expect(keybindingForCommand('no-such-command')).toBeUndefined()
    })

    it('only names real commands and real catalog keybindings', () => {
        const keys = new Set(KEYBINDING_CATALOG.map(k => k.id as string))
        for (const id of KEYED_COMMAND_IDS) {
            expect(COMMAND_IDS).toContain(id)
            expect(keys.has(keybindingForCommand(id)!)).toBe(true)
        }
    })
})
