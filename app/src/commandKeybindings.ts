// app/src/commandKeybindings.ts
// Command id → the catalog keybinding that runs the SAME action (core/src/keybindings.ts).
// An id appears here only when App.tsx's global keydown handler calls the same function the
// command's bound action calls; a command with no such key shows no hint (nothing is fabricated).
// The toolbar buttons hand the result to IconButton's `keybinding`, and the command palette
// renders it as a Kbd, both from the user's live combo.
import type { KeybindingId } from '../../core/src/keybindings'

const COMMAND_KEYBINDINGS: Record<string, KeybindingId> = {
    terminal: 'terminal',
    'new-tab': 'new-tab',
    'reopen-tab': 'reopen-tab',
    'history-back': 'history-back',
    'history-forward': 'history-forward',
    'new-window': 'new-window',
    'open-folder': 'open-folder',
    export: 'export',
    'new-claude-chat': 'new-claude-chat',
    'quick-ask': 'quick-ask',
    'equalize-panes': 'equalize-panes',
    'split-right': 'split-right',
    'split-down': 'split-down',
    'close-pane': 'close-pane',
    'focus-pane-left': 'focus-pane-left',
    'focus-pane-right': 'focus-pane-right',
    'focus-pane-up': 'focus-pane-up',
    'focus-pane-down': 'focus-pane-down',
    'toggle-sidebar': 'toggle-sidebar',
    'toggle-tab-rail': 'toggle-tab-rail',
    'zoom-in': 'zoom-in',
    'zoom-out': 'zoom-out',
    'zoom-reset': 'zoom-reset',
}

/** The keybinding that does what this command does, or undefined when no key runs it. */
export function keybindingForCommand(id: string): KeybindingId | undefined {
    return COMMAND_KEYBINDINGS[id]
}

/** Every command id with a verified key, for the test that pins the set. */
export const KEYED_COMMAND_IDS: string[] = Object.keys(COMMAND_KEYBINDINGS)
