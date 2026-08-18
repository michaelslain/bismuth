// app/src/palette/CommandPalette.tsx
// Cmd+P — a fuzzy-searchable list of actions. Thin wrapper over PaletteModal that
// renders the bound command list (App owns the catalog->action binding) and runs
// the chosen command's action (then closes).
import { PaletteModal, type PaletteItem } from './PaletteModal'
import type { BoundCommand } from '../commands'
import { settings } from '../settings'
import { loadFrecency, recordUse, scoreOf, commandKey } from '../frecency'

// Command id → keybinding id (core/src/keybindings.ts). Only commands whose action
// has a real global keybinding appear here; the rest render no hint (no fabrication).
const COMMAND_KEYBINDINGS: Record<string, keyof typeof settings.keybindings> = {
    terminal: 'terminal',
    'equalize-panes': 'equalize-panes',
    'toggle-sidebar': 'toggle-sidebar',
    'new-tab': 'new-tab',
    'reopen-tab': 'reopen-tab',
    'history-back': 'history-back',
    'history-forward': 'history-forward',
}

type Props = {
    onClose: () => void
    commands: Map<string, BoundCommand>
}

export function CommandPalette(props: Props) {
    const list = () => [...props.commands.values()]
    // The RAW combo string ("Mod+Shift+D") — PaletteModal renders it via the shared Kbd
    // primitive (ui/ascii/Kbd.tsx, parseCombo), which owns the Mod→⌘/Ctrl mapping this file used
    // to duplicate inline (formatShortcut, retired).
    const shortcutFor = (id: string): string | undefined => {
        const kb = COMMAND_KEYBINDINGS[id]
        return kb ? settings.keybindings[kb] : undefined
    }
    const items = (): PaletteItem[] =>
        list().map(c => ({
            id: c.id,
            label: c.label,
            icon: c.icon,
            shortcut: shortcutFor(c.id),
        }))

    // Snapshot frecency once per open (fixed `now`): recently/frequently run commands sort
    // first on an empty query and get boosted in fuzzy results (see PaletteModal blend).
    const store = loadFrecency()
    const now = Date.now()

    return (
        <PaletteModal
            placeholder="Select a command..."
            items={items()}
            frecency={id => scoreOf(store[commandKey(id)], now)}
            emptyText="No matching commands"
            onClose={props.onClose}
            onSelect={item => {
                recordUse(commandKey(item.id)) // learn: running a command boosts it next time
                props.commands.get(item.id)?.action()
                props.onClose()
            }}
        />
    )
}
