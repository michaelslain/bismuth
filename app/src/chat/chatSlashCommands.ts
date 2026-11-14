// app/src/chatSlashCommands.ts
// Pure parser for the chat composer's CLIENT-SIDE slash commands (Row 75): `/rename <name>` and
// `/color <swatch|hex|clear>`. These are intercepted in chat/chatSession.ts BEFORE the turn is sent to Claude —
// they act on the chat TAB (rename / pane tint), never reach the model as a prompt. Kept pure + DOM-
// free so it's unit-testable headlessly.

export type ChatSlashCommand =
    | { kind: 'rename'; name: string }
    // `arg` is the RAW color token as typed; the caller resolves it via resolveChatColorArg (so an
    // unknown token can be reported rather than silently ignored).
    | { kind: 'color'; arg: string }

/** Parse a composer draft as a client-side chat command, or null when it isn't one — then the draft
 *  flows on normally (a real Claude slash command, or plain prose). Only a LEADING
 *  `/rename`/`/color` (case-insensitive) is intercepted; the rest of the line is the argument
 *  (trimmed). An empty `/rename` arg is kept (the caller reverts the tab to its auto label, like
 *  clearing an inline rename); an empty `/color` arg means "clear the tint". */
export function parseChatSlashCommand(input: string): ChatSlashCommand | null {
    const trimmed = input.trim()
    if (!trimmed.startsWith('/')) return null
    const sp = trimmed.search(/\s/)
    const cmd = (
        sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp)
    ).toLowerCase()
    const arg = sp === -1 ? '' : trimmed.slice(sp + 1).trim()
    if (cmd === 'rename') return { kind: 'rename', name: arg }
    if (cmd === 'color' || cmd === 'colour') return { kind: 'color', arg }
    return null
}

/** BUG #87 ("/chrome command missing"): the composer's "/" autocomplete (ChatComposerBar's `slashMatches`)
 *  used to be built ONLY from the backend session's own `manifest.slashCommands` — which never
 *  includes these client-side commands, so they never showed up in the picker even though typing
 *  one out by hand worked. These are pure CLIENT concepts (tab rename / pane tint) intercepted
 *  before a turn ever reaches the backend, so they're spliced in HERE rather than polluting
 *  core/chat.ts's LOCAL_SLASH_COMMANDS (which is for commands the backend itself answers, like
 *  `/mcp`). `detail` powers the popover row's description text (mirrors chat/chatSession.ts's
 *  SLASH_COMMAND_DETAILS for synthesized commands). */
export const CLIENT_SLASH_COMMANDS: {
    name: string
    detail: string
    hint: string
}[] = [
    { name: 'rename', detail: 'Rename this chat tab', hint: '<name>' },
    {
        name: 'color',
        detail: "Tint this chat's pane",
        hint: '<swatch|hex|clear>',
    },
]

/** Merge the client-side commands into a manifest's own slash-command names for the "/" autocomplete
 *  (BUG #87). Client commands are APPENDED after the backend's own list, deduped by name (a same-
 *  named backend command — unlikely — isn't shadowed). Works even before any manifest exists (an
 *  empty `commands` in) so `/rename`/`/color` are offered from the moment the chat opens, not just
 *  after the session's first manifest lands. Pure — unit-tested without Solid. */
export function withClientSlashCommands(commands: string[]): string[] {
    const out = [...commands]
    for (const c of CLIENT_SLASH_COMMANDS)
        if (!out.includes(c.name)) out.push(c.name)
    return out
}

/** The commands the "/" popover offers for `query` (the draft after its `/`, lowercased), best
 *  first: a name that starts with it, then a name whose later part does (`brain` finds
 *  `superpowers:brainstorming`, `review` finds `code-review`), then a name that contains it. List
 *  order is kept within each group, and a name listed twice is offered once. An empty query offers
 *  every command. Pure. */
export function matchSlashCommands(
    commands: string[],
    query: string,
    limit = 50,
): string[] {
    const q = query.toLowerCase()
    const unique = [...new Set(commands)]
    if (!q) return unique.slice(0, limit)
    const groups: string[][] = [[], [], []]
    for (const c of unique) {
        const name = c.toLowerCase()
        if (name.startsWith(q)) groups[0].push(c)
        else if (name.split(/[:\-_./]/).some(part => part.startsWith(q)))
            groups[1].push(c)
        else if (name.includes(q)) groups[2].push(c)
    }
    return groups.flat().slice(0, limit)
}

/** The `/command` token the caret sits in, or null: a `/` at the start of the draft or after
 *  whitespace, then the non-space characters up to the caret (`textBefore` is the draft up to the
 *  caret). `from` is the offset of the `/` itself, so a pick replaces the whole `/query` span; `query`
 *  is what follows it, lowercased. A `/` inside a word (`a/b`, `http://`) is not a command. Pure. */
export function slashTokenAt(
    textBefore: string,
): { from: number; query: string } | null {
    const m = /(?:^|\s)\/(\S*)$/.exec(textBefore)
    if (!m) return null
    const from = textBefore.length - m[1].length - 1
    return { from, query: m[1].toLowerCase() }
}

/** The argument hint to show greyed after the caret, or undefined: the text before the caret ends in
 *  a known command (at the start or after whitespace) followed by spaces, and nothing but whitespace
 *  follows the caret on its line (`/bust ` → `[deep] [K] <goal>`). The hint goes away as soon as an
 *  argument is typed, and never shows for a bare `/bust` (the popover shows it there). Pure. */
export function slashArgHint(
    textBefore: string,
    hintFor: (name: string) => string | undefined,
    textAfter = '',
): string | undefined {
    if (/^[ \t]*\S/.test(textAfter.split('\n')[0])) return undefined
    const m = /(?:^|\s)\/(\S+)[ \t]+$/.exec(textBefore)
    if (!m) return undefined
    return hintFor(m[1]) || undefined
}
