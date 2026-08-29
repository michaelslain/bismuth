// Visual spec for <CommandPalette> — Cmd+P's fuzzy command list. Thin wrapper over
// PaletteModal: it builds PaletteItems from a `Map<string, BoundCommand>` (App's real
// catalog->action binding shape) and attaches a real keybinding hint for the handful of
// commands COMMAND_KEYBINDINGS names, reading it off `settings.keybindings` — not a
// fabricated shortcut string.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CommandPalette } from './CommandPalette'
import type { BoundCommand } from '../commands'

const meta = {
    title: 'Palette/CommandPalette',
    component: CommandPalette,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CommandPalette>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A representative slice of the real command catalog (core/src/commands.ts's
 *  COMMAND_CATALOG shape) — some ids overlap CommandPalette's COMMAND_KEYBINDINGS map (so
 *  those rows show a real Kbd hint), most don't (most commands have no global keybinding). */
function sampleCommands(): Map<string, BoundCommand> {
    const list: BoundCommand[] = [
        {
            id: 'terminal',
            label: 'Open Terminal',
            icon: 'SquareTerminal',
            action: noop,
        },
        {
            id: 'toggle-sidebar',
            label: 'Toggle Sidebar',
            icon: 'PanelLeft',
            action: noop,
        },
        { id: 'new-tab', label: 'New Tab', icon: 'Plus', action: noop },
        {
            id: 'reopen-tab',
            label: 'Reopen Closed Tab',
            icon: 'RotateCcw',
            action: noop,
        },
        {
            id: 'equalize-panes',
            label: 'Equalize Panes',
            icon: 'Columns2',
            action: noop,
        },
        { id: 'new-note', label: 'New Note', icon: 'FilePlus', action: noop },
        {
            id: 'new-folder',
            label: 'New Folder',
            icon: 'FolderPlus',
            action: noop,
        },
        {
            id: 'create-menu',
            label: 'Create...',
            icon: 'Plus',
            interactive: true,
            action: noop,
        },
        { id: 'export', label: 'Export Note', icon: 'Download', action: noop },
        {
            id: 'archive-tasks',
            label: 'Archive Completed Tasks',
            icon: 'Archive',
            action: noop,
        },
        {
            id: 'detect-ai',
            label: 'Detect AI-Written Text',
            icon: 'Sparkles',
            action: noop,
        },
        { id: 'find', label: 'Find in Note', icon: 'Search', action: noop },
    ]
    return new Map(list.map(c => [c.id, c]))
}

/** Open, unfiltered — the empty-query state lists every bound command in catalog order (no
 *  frecency history in a fresh Storybook session, so nothing floats to the top yet). */
export const Default: Story = {
    render: () => <CommandPalette onClose={noop} commands={sampleCommands()} />,
}

/** Empty catalog — App always has commands bound, but the palette itself renders correctly
 *  (PaletteModal's own emptyText) if it's ever handed a Map with nothing selected in. */
export const Empty: Story = {
    render: () => <CommandPalette onClose={noop} commands={new Map()} />,
}
