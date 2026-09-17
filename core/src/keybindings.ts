// core/src/keybindings.ts
// The keybinding catalog: pure metadata for every global, app-level keyboard
// shortcut. Lives in core (no frontend imports) so the settings schema can
// derive the `keybindings` section from it, and the frontend can match a
// KeyboardEvent against each id (see app/src/keybindings.ts + App.tsx). Single
// source of truth for keybinding ids AND their default combos — App.tsx reads
// settings.keybindings.<id>, never a hardcoded combo.
//
// Combo syntax (see app/src/keybindings.ts for the matcher):
//   "Mod"   — Cmd on macOS / Ctrl elsewhere (matches metaKey OR ctrlKey)
//   "Alt"   — Option/Alt;  "Shift" — Shift
//   final token is the key, e.g. "P", "D", "=", "`", "ArrowLeft"
//   comma-separate alternatives: "Mod+`, Mod+J"
// Matching is EXACT on modifiers, so "Mod+D" (split-right) and "Mod+Shift+D"
// (split-down) never collide.

export interface KeybindingSpec {
    /** Stable id; the YAML key under `keybindings:` and the lookup App.tsx uses. */
    id: string
    /** Human label (for docs / a future shortcuts cheat-sheet). */
    label: string
    /** Default combo string, equal to the value previously hardcoded in App.tsx. */
    default: string
    /** One-line doc surfaced by settings autocomplete + the parity test. */
    doc: string
}

export const KEYBINDING_CATALOG: KeybindingSpec[] = [
    {
        id: 'find',
        label: 'Find in note',
        default: 'Mod+F',
        doc: 'Open the in-note find bar in the focused editor (searches the current note).',
    },
    {
        id: 'command-palette',
        label: 'Toggle command palette',
        default: 'Mod+P',
        doc: 'Open/close the command palette.',
    },
    {
        id: 'quick-switcher',
        label: 'Toggle quick switcher',
        default: 'Mod+O',
        doc: 'Open/close the quick file switcher.',
    },
    {
        id: 'terminal',
        label: 'Open terminal',
        default: 'Mod+`, Mod+J',
        doc: 'Open a terminal tab (comma-separated alternatives allowed).',
    },
    {
        id: 'toggle-draw-mode',
        label: 'Toggle draw mode',
        default: 'Mod+Shift+I',
        doc: 'Toggle ink/draw mode in the focused note editor — draw freehand over the note (Escape also exits). Mnemonic: Ink. On Linux/Windows Ctrl+Shift+I collides with browser devtools — rebind if needed.',
    },
    {
        id: 'split-right',
        label: 'Split pane right',
        default: 'Mod+D',
        doc: 'Split the focused pane into a new pane to the right.',
    },
    {
        id: 'split-down',
        label: 'Split pane down',
        default: 'Mod+Shift+D',
        doc: 'Split the focused pane into a new pane below.',
    },
    {
        id: 'equalize-panes',
        label: 'Equalize panes',
        default: 'Mod+Alt+=',
        doc: 'Reset all split panes to equal sizes.',
    },
    {
        id: 'close-pane',
        label: 'Close pane',
        default: 'Mod+W',
        doc: "Close the focused pane (closes the whole tab when it's the last pane).",
    },
    {
        id: 'new-tab',
        label: 'New tab',
        default: 'Mod+T',
        doc: 'Open a new tab (the Knowledge Graph home).',
    },
    {
        id: 'reopen-tab',
        label: 'Reopen closed tab',
        default: 'Mod+Shift+T',
        doc: 'Reopen the most recently closed tab.',
    },
    {
        id: 'history-back',
        label: 'Back',
        default: 'Mod+[',
        doc: "Go back in the focused pane's navigation history.",
    },
    {
        id: 'history-forward',
        label: 'Forward',
        default: 'Mod+]',
        doc: "Go forward in the focused pane's navigation history.",
    },
    {
        id: 'focus-pane-left',
        label: 'Focus pane left',
        default: 'Mod+Alt+ArrowLeft',
        doc: 'Move focus to the pane on the left.',
    },
    {
        id: 'focus-pane-right',
        label: 'Focus pane right',
        default: 'Mod+Alt+ArrowRight',
        doc: 'Move focus to the pane on the right.',
    },
    {
        id: 'focus-pane-up',
        label: 'Focus pane up',
        default: 'Mod+Alt+ArrowUp',
        doc: 'Move focus to the pane above.',
    },
    {
        id: 'focus-pane-down',
        label: 'Focus pane down',
        default: 'Mod+Alt+ArrowDown',
        doc: 'Move focus to the pane below.',
    },
    {
        id: 'new-claude-chat',
        label: 'New Claude chat',
        default: 'Mod+Shift+C',
        doc: 'Open a new Claude Code chat session in its own tab.',
    },
    {
        id: 'insert-template',
        label: 'Insert template',
        default: 'Alt+T',
        doc: 'Open the template-insertion palette (ignored while typing in a form field).',
    },
    {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        default: 'Alt+S',
        doc: 'Show/hide the left sidebar (ignored while typing in a form field).',
    },
    {
        id: 'toggle-tab-rail',
        label: 'Toggle tab rail',
        default: 'Alt+Shift+S',
        doc: "Pin the right tab rail open, or let it go back to expanding only on hover (ignored while typing in a form field). Deliberately the left sidebar's Alt+S plus Shift — the two are the same gesture on the app's two edges.",
    },
    {
        id: 'zoom-in',
        label: 'Zoom in',
        default: 'Mod+=, Mod+Shift+=',
        doc: 'Increase the whole app\'s UI zoom one step. Mod+Shift+= covers keyboards where the labeled "+" requires Shift.',
    },
    {
        id: 'zoom-out',
        label: 'Zoom out',
        default: 'Mod+-',
        doc: "Decrease the whole app's UI zoom one step.",
    },
    {
        id: 'zoom-reset',
        label: 'Reset zoom',
        default: 'Mod+0',
        doc: "Reset the whole app's UI zoom to 100%.",
    },
    {
        id: 'open-completion',
        label: 'Open autocomplete',
        default: 'Ctrl+Space, Mod+Shift+Space',
        doc: 'Open the autocomplete popup (wikilinks, tags, mentions, settings keys) in the focused editor or composer. Mod+Shift+Space is a fallback because Ctrl+Space is taken by the macOS input-source switcher whenever more than one input source is enabled.',
    },
    {
        id: 'accept-completion',
        label: 'Accept autocomplete suggestion',
        default: 'Tab',
        doc: 'Accept the highlighted suggestion in an open autocomplete popup.',
    },
    {
        id: 'indent',
        label: 'Indent',
        default: 'Tab',
        doc: 'Indent the current line or selection one level (runs only when no autocomplete popup is open to accept instead).',
    },
    {
        id: 'outdent',
        label: 'Outdent',
        default: 'Shift+Tab',
        doc: 'Outdent the current line or selection one level.',
    },
    {
        id: 'toggle-bold',
        label: 'Toggle bold',
        default: 'Mod+B',
        doc: 'Toggle bold on the current selection.',
    },
    {
        id: 'toggle-italic',
        label: 'Toggle italic',
        default: 'Mod+I',
        doc: 'Toggle italic on the current selection.',
    },
    {
        id: 'chat-send',
        label: 'Send chat message',
        default: 'Enter',
        doc: 'Send the current chat message.',
    },
    {
        id: 'chat-newline',
        label: 'Insert chat newline',
        default: 'Shift+Enter',
        doc: 'Insert a newline in the chat composer without sending the message.',
    },
    {
        id: 'chat-stop',
        label: 'Stop chat response',
        default: 'Escape',
        doc: 'Stop the chat reply currently streaming.',
    },
    {
        id: 'chat-history-prev',
        label: 'Recall previous chat message',
        default: 'ArrowUp',
        doc: 'Recall the previously sent message into the composer, from the first visual line of the draft.',
    },
    {
        id: 'chat-history-next',
        label: 'Recall next chat message',
        default: 'ArrowDown',
        doc: 'Step forward through recalled chat messages, from the last visual line of the draft.',
    },
    {
        id: 'undo-delete',
        label: 'Undo file-tree delete',
        default: 'Mod+Z',
        doc: 'Undo the most recent file-tree delete, restoring the file or folder from trash.',
    },
    {
        id: 'delete-selection',
        label: 'Delete selected file',
        default: 'Delete, Backspace',
        doc: 'Delete the selected file or folder in the file tree (moves it to trash; undoable).',
    },
    {
        id: 'flashcard-flip',
        label: 'Flip flashcard',
        default: 'Space',
        doc: 'Flip the current flashcard between its front and back.',
    },
    {
        id: 'flashcard-hard',
        label: 'Grade flashcard hard',
        default: '1',
        doc: 'Grade the current flashcard Hard and advance to the next one.',
    },
    {
        id: 'flashcard-good',
        label: 'Grade flashcard good',
        default: '2',
        doc: 'Grade the current flashcard Good and advance to the next one.',
    },
    {
        id: 'flashcard-easy',
        label: 'Grade flashcard easy',
        default: '3',
        doc: 'Grade the current flashcard Easy and advance to the next one.',
    },
    {
        id: 'graph-reset-view',
        label: 'Reset graph view',
        default: 'Escape',
        doc: 'Reset the knowledge graph camera to its default position and zoom.',
    },
    {
        id: 'graph-focus-node',
        label: 'Focus hovered graph node',
        default: 'Z',
        doc: 'Focus and center the hovered graph node (resets the view instead when nothing is hovered).',
    },
    {
        id: 'graph-zoom-in',
        label: 'Zoom graph in',
        default: '=, Shift+=, Plus',
        doc: 'Zoom the knowledge graph in one step.',
    },
    {
        id: 'graph-zoom-out',
        label: 'Zoom graph out',
        default: '-, Shift+-',
        doc: 'Zoom the knowledge graph out one step.',
    },
    {
        id: 'ink-undo',
        label: 'Undo ink stroke',
        default: 'Mod+Z',
        doc: 'Undo the last ink stroke on the current drawing surface.',
    },
    {
        id: 'ink-redo',
        label: 'Redo ink stroke',
        default: 'Mod+Shift+Z',
        doc: 'Redo the last undone ink stroke on the current drawing surface.',
    },
    {
        id: 'exit-draw-mode',
        label: 'Exit draw mode',
        default: 'Escape',
        doc: 'Exit ink/draw mode and return to normal editing or reading.',
    },
    {
        id: 'ui-dismiss',
        label: 'Dismiss panel',
        default: 'Escape',
        doc: 'Close or cancel the focused transient panel — a modal, popover, or menu.',
    },
    {
        id: 'ui-confirm',
        label: 'Confirm panel',
        default: 'Enter',
        doc: 'Confirm or accept the focused transient panel — a modal, popover, or menu.',
    },
]
