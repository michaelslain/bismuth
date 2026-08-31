// app/src/plural.ts
//
// One place for "1 node" vs "2 nodes". Pure and framework-free, so it is unit-testable and every
// readout that counts something can agree — the graph's stats footer read "1 nodes // 0 edges"
// until this existed, because each call site was concatenating a bare count to a hardcoded plural.
//
// English-only and deliberately so: this is not an i18n layer. It handles the one rule the app's
// own readouts need (count === 1 takes the singular), and anything with an irregular plural passes
// its own second form rather than teaching this module about English morphology.

/** `"1 node"` / `"2 nodes"`. Pass `many` for an irregular plural (`plural(n, 'entry', 'entries')`). */
export function plural(count: number, one: string, many?: string): string {
    return `${count} ${pluralWord(count, one, many)}`
}

/** Just the noun, for call sites that render the number separately (a styled count, a `<b>`). */
export function pluralWord(count: number, one: string, many?: string): string {
    return count === 1 ? one : (many ?? `${one}s`)
}
