// app/src/bases/groupHue.ts
// The colour a group key gets with no explicit override: the known-status palette first, then a
// slot of the theme's graph ramp (--graph-0..4) picked by a stable hash of the KEY, never its
// position — so reordering groups/columns never recolours them. Shared by KanbanView (column
// colour) and CardsView (a grouped card's cover hue) so one key reads as one category everywhere.
import { STATUS_COLOR } from '../ui/StatusDot'

// Every theme's --graph-0..4 ramp is rose/violet/blue/teal/green in that order
// (kanbanPalette.ts carries the matching names for the picker).
export const GROUP_PALETTE = [
    'var(--graph-0)',
    'var(--graph-1)',
    'var(--graph-2)',
    'var(--graph-3)',
    'var(--graph-4)',
]

export function autoGroupColor(key: string): string {
    const status = STATUS_COLOR[key.trim().toLowerCase()]
    if (status) return status
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
    return GROUP_PALETTE[Math.abs(h) % GROUP_PALETTE.length]
}
