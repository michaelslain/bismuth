// app/src/palette/CommandPalette.tsx
// Cmd+P — a fuzzy-searchable list of actions. Thin wrapper over PaletteModal that
// renders the bound command list (App owns the catalog->action binding) and runs
// the chosen command's action (then closes).
import { PaletteModal, type PaletteItem } from './PaletteModal'
import type { BoundCommand } from '../commands'
import { settings } from '../settings'
import { keybindingForCommand } from '../commandKeybindings'
import { loadFrecency, recordUse, scoreOf, commandKey } from '../frecency'

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
        const kb = keybindingForCommand(id)
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
            placeholder="commands"
            prompt=">"
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
