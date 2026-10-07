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

// Where each named swatch sits in GROUP_PALETTE: a status colour (`var(--teal)`) and a ramp slot
// (`var(--graph-3)`) are the same hue in every theme, so they must count as ONE colour.
const SWATCH_SLOT: Record<string, number> = {
    'var(--rose)': 0,
    'var(--violet)': 1,
    'var(--blue)': 2,
    'var(--teal)': 3,
    'var(--green)': 4,
}

function slotOf(color: string): number {
    const i = GROUP_PALETTE.indexOf(color)
    return i >= 0 ? i : (SWATCH_SLOT[color] ?? -1)
}

/** The palette slots a board's NAMED columns already own: a key with a known-status colour
 *  (`doing` = teal) or a stored override takes that swatch. An auto-coloured key never claims one,
 *  so one key's colour depends only on its own hash and this set, never on the others' order. */
export function claimedSlots(
    keys: readonly string[],
    overrides: Readonly<Record<string, string>> = {},
): Set<number> {
    const claimed = new Set<number>()
    for (const key of keys) {
        const color = overrides[key] ?? STATUS_COLOR[key.trim().toLowerCase()]
        const slot = color === undefined ? -1 : slotOf(color)
        if (slot >= 0) claimed.add(slot)
    }
    return claimed
}

/** `claimed` (from `claimedSlots`) makes an auto-coloured key step past the swatches a named column
 *  on the same board already owns, so two columns never paint the same dot. The step is allocation
 *  only: it picks a different slot of the same ramp, no swatch value changes. */
export function autoGroupColor(key: string, claimed?: ReadonlySet<number>): string {
    const status = STATUS_COLOR[key.trim().toLowerCase()]
    if (status) return status
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
    const start = Math.abs(h) % GROUP_PALETTE.length
    if (claimed)
        for (let i = 0; i < GROUP_PALETTE.length; i++) {
            const slot = (start + i) % GROUP_PALETTE.length
            if (!claimed.has(slot)) return GROUP_PALETTE[slot]
        }
    return GROUP_PALETTE[start]
}
