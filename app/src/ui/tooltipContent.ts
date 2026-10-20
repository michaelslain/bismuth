// app/src/ui/tooltipContent.ts
// What a tooltip bubble shows: the holder's hover name plus the live combo of its catalog keybinding.
// Pure; TooltipHost passes the live `settings.keybindings` each time it opens.

export type TooltipContent = {
    /** The hover name; '' when the holder has only a keybinding. */
    label: string
    /** The app's keybinding syntax ("Mod+P", or "Mod+`, Mod+J" alternatives); '' when none is bound. */
    combo: string
}

/** Resolve a holder's `data-tooltip` + `data-tooltip-keybinding` against the live bindings.
 *  Returns null when there is nothing to show. */
export function tooltipContent(
    label: string | null | undefined,
    id: string | null | undefined,
    keybindings: Record<string, string>,
): TooltipContent | null {
    const name = label ?? ''
    const combo = (id ? keybindings[id] : undefined) ?? ''
    if (!name && !combo) return null
    return { label: name, combo }
}
