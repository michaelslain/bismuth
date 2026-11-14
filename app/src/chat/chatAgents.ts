// app/src/chat/chatAgents.ts
// Pure helper for cycling a backend's primary agents (opencode's build, plan, the user's own) with
// Shift+Tab. No framework imports.

/** The agent after `current`, wrapping to the first. null when there is nothing to cycle to (under
 *  two entries). A `current` missing from the list moves to the first entry. */
export function nextAgent(
    list: readonly { value: string }[],
    current: string,
): string | null {
    if (list.length < 2) return null
    const at = list.findIndex(a => a.value === current)
    return list[(at + 1) % list.length].value
}

/** The remembered agent to push to a fresh session, or null when none should be sent: a resumed
 *  conversation keeps its own agent, a backend without agents has nothing to set, and an unknown,
 *  empty or already-current choice needs no push. */
export function rememberedAgentToPush(input: {
    resumed: boolean
    can: boolean
    list: readonly { value: string }[]
    want: string | null | undefined
    current: string
}): string | null {
    if (input.resumed || !input.can) return null
    const want = input.want
    if (!want || want === input.current) return null
    return input.list.some(a => a.value === want) ? want : null
}
