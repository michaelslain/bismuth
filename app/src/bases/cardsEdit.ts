// Pure helpers behind EditCardsModal: the bulk-paste parser and the list edits. No framework
// imports (cardsEdit.test.ts runs headlessly).

export type ParsedCard = { front: string; back: string }

/** Bulk-add separator presets. "auto" sniffs each line for the first that matches. */
export const SEPARATORS: { id: string; label: string; sep: string }[] = [
    { id: 'tab', label: 'tab', sep: '\t' },
    { id: 'tripcolon', label: ':::', sep: ':::' },
    { id: 'dblcolon', label: '::', sep: '::' },
    { id: 'colon', label: ':', sep: ':' },
    { id: 'pipe', label: '|', sep: '|' },
    { id: 'comma', label: ',', sep: ',' },
    { id: 'dash', label: '–', sep: '–' },
]

// Auto-detect probes separators most-specific first so "::" beats ":".
const AUTO_ORDER = [
    'tab',
    'tripcolon',
    'dblcolon',
    'pipe',
    'dash',
    'colon',
    'comma',
]

function splitOn(line: string, sep: string): [string, string] {
    const i = line.indexOf(sep)
    if (i < 0) return [line.trim(), '']
    return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()]
}

/** Parse pasted text into {front, back} cards using the chosen separator (or auto). */
export function parseBulk(text: string, delim: string): ParsedCard[] {
    const sepOf = (id: string) => SEPARATORS.find(s => s.id === id)!.sep
    return text
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            if (delim === 'auto') {
                for (const id of AUTO_ORDER)
                    if (line.includes(sepOf(id)))
                        return splitOn(line, sepOf(id))
                return [line.trim(), ''] as [string, string]
            }
            return splitOn(line, sepOf(delim))
        })
        .map(([front, back]) => ({ front, back }))
}

/** The cards a bulk add will actually create: a card with no front is dropped. */
export function validCards(parsed: ParsedCard[]): ParsedCard[] {
    return parsed.filter(c => c.front)
}

/** A copy with the item at `from` moved to `to` (splice out, then splice in). */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
    const next = [...arr]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
    return arr.filter((_, i) => i !== index)
}

export function insertAt<T>(arr: readonly T[], index: number, item: T): T[] {
    const next = [...arr]
    next.splice(index, 0, item)
    return next
}

const LABEL_MAX = 28

/** What a delete toast calls the card: its front, trimmed and capped, else "card". */
export function deletedLabel(
    note: Record<string, unknown>,
    frontField: string,
): string {
    const front = String(note[frontField] ?? '').trim()
    if (!front) return 'card'
    return front.length > LABEL_MAX ? front.slice(0, LABEL_MAX - 1) + '…' : front
}
