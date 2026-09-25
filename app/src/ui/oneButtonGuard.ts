// app/src/ui/oneButtonGuard.ts
// Pure detectors behind the ONE-BUTTON guard (oneButton.test.ts). No framework, no DOM — each
// function takes file text (already comment-stripped by the caller where that matters) and
// answers one yes/no question about it.

/** True if `text` renders a raw button by any of the two spellings a person can click:
 *  JSX `<button` or an imperative `document.createElement('button')` / `createElement("button")`
 *  (whitespace-tolerant between the call and its string-literal first argument). The imperative
 *  form is invisible to a `<button` scan entirely — CodeMirror/plain-DOM widgets build their
 *  buttons this way (CardEditor's fold toggle, findPanel's icon buttons, tableWidget's row/column
 *  controls), and a scan limited to JSX would never see them. */
export function hasRawButton(text: string): boolean {
    if (/<button\b/.test(text)) return true
    return /createElement\s*\(\s*['"]button['"]/.test(text)
}

/** True if `text` imports from a specifier that resolves to `ui/Button` (any depth) or a local
 *  `./Button`/`../Button`, with an optional `.tsx`/`.ts`/`.js` extension — but NOT a sibling whose
 *  name merely starts with "Button" (`./ButtonGroup`, `./IconButton`, `./TextButton`,
 *  `./PlainButton`) or a helper module (`./buttonClass`). The bare `.pop()`-last-segment check the
 *  guard used before this module matched `'./ButtonGroup'`.split('/').pop() === 'ButtonGroup', not
 *  'Button' — so that case was already excluded — but it also missed a specifier ending in
 *  `Button.tsx`/`Button.js` (`last === 'Button'` was false against `'Button.tsx'`), which is what
 *  this rewrite fixes. */
export function importsButtonBase(text: string): boolean {
    const IMPORT_FROM = /from\s+['"]([^'"]+)['"]/g
    for (const m of text.matchAll(IMPORT_FROM)) {
        const specifier = m[1]!
        const last = specifier.split('/').pop() ?? ''
        const base = last.replace(/\.(tsx|ts|js)$/, '')
        if (base === 'Button') return true
    }
    return false
}
