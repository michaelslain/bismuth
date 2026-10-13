// core/src/drawing/pageDark.ts
// Pure helpers for a sidecar's `dark` flag (core/src/drawing/model.ts) — whether ONE PDF shows its
// pages inverted. The flag is per file; `appearance.pdfDarkMode` is only the default for a file
// that has none, so the reader's choice on one PDF is remembered without touching any other.
import type { DrawingDoc } from './model'

/** Whether the doc's PDF shows dark: its own `dark` when it holds a boolean, else `fallback`
 *  (the `appearance.pdfDarkMode` default). A corrupt non-boolean value counts as absent. */
export function darkOf(doc: DrawingDoc | null, fallback: boolean): boolean {
    const d = doc?.dark
    return typeof d === 'boolean' ? d : fallback
}

/** `doc` with its `dark` flag set. Stores `false` as well as `true`: a light choice has to
 *  outlive a dark default. Hands `doc` back unchanged when the flag already holds `on`, so the
 *  annotation store records no undo step and writes nothing. Never mutates `doc`. */
export function setDark(doc: DrawingDoc, on: boolean): DrawingDoc {
    if (doc.dark === on) return doc
    return { ...doc, dark: on }
}
