// app/src/ui/barFit.ts
// Which droppable trail elements a view bar must hide so what is left fits. Pure: ViewBar.tsx
// measures, this decides. A level names an ORDER, not a width — 4 goes first, 1 goes last — and a
// level drops as a whole.
export type BarDropLevel = 1 | 2 | 3 | 4
/** Every level the contract defines, in the order they drop. */
export const BAR_DROP_LEVELS: readonly BarDropLevel[] = [4, 3, 2, 1]

export type BarFitGroup = { level: BarDropLevel; width: number }
export type BarFitInput = {
    /** The bar's content-box width. */
    available: number
    /** The lead's minimum + every never-dropping trail element + the gaps between them. */
    fixed: number
    /** Droppable elements with their natural (shown) widths, each including its gap. */
    groups: BarFitGroup[]
    /** The overflow trigger and its gap — charged only when something drops. */
    trigger: number
}
export type BarFitResult = { hiddenLevels: number[] }

/** Hides level 4, then 3, 2, 1 cumulatively until the rest fits beside the trigger. A set only
 *  counts when it is a NET saving: the width it frees must exceed the trigger it costs, otherwise
 *  the bar trades a control for a [≡] of the same width and gains nothing. When no set both fits
 *  and saves, nothing hides and the bar's own floor tiers handle the squeeze. When even all four
 *  hidden does not fit but saves, all four hide. */
export function dropsToFit(input: BarFitInput): BarFitResult {
    const total = input.groups.reduce((sum, g) => sum + g.width, 0)
    if (input.fixed + total <= input.available) return { hiddenLevels: [] }
    const hidden: number[] = []
    let remaining = total
    for (const level of BAR_DROP_LEVELS) {
        hidden.push(level)
        remaining -= input.groups
            .filter(g => g.level === level)
            .reduce((sum, g) => sum + g.width, 0)
        const saves = total - remaining > input.trigger
        if (saves && input.fixed + input.trigger + remaining <= input.available)
            return { hiddenLevels: hidden }
    }
    return total > input.trigger ? { hiddenLevels: [...BAR_DROP_LEVELS] } : { hiddenLevels: [] }
}
