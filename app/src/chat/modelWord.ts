// app/src/chat/modelWord.ts
// The one word the row shows for "what is answering" — folds the old provider/model/effort trio of
// controls down to a single lowercase label on ChatModelMenu's trigger. Pure, no Solid import, so
// the shortening rules are unit-tested without a live session.
//
// Only a backend-supplied LABEL is shortened ("Opus (1M context)" -> "opus (1m)") — a raw model id
// ("claude-opus-4-8") is lowercased and returned as-is. Attempting to strip a vendor prefix or
// reformat a raw id ("claude-opus-4-8" -> "opus 4.8") is explicitly NOT done here: ids are not
// guaranteed to follow any one shape across backends, and guessing at one risks mangling a value
// nothing actually labelled as shortenable.

/** Matches a parenthetical context-window note, lowercased already by the caller — "(1m context)",
 *  "(200k context window)" — and captures just the size token ("1m", "200k"). */
const CONTEXT_NOTE = /\((\d+(?:\.\d+)?[km])\s*context(?:\s*window)?\)/g

export function modelWord(label: string): string {
    if (!label) return label
    return label.toLowerCase().replace(CONTEXT_NOTE, (_match, size: string) => `(${size})`)
}
