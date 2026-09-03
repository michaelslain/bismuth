// app/src/ui/_fontFace.ts
// Story-only assertion helpers: "this element renders in the note PROSE face" and "…in the
// EDITOR's mono face, at the editor size".
//
// Note prose, chat message bodies and note tables paint in --prose-font (CMU Serif), the ONE
// proportional exception to the app's single mono family — see CLAUDE.md's Typography note and
// styles/tokens.css. Everything pulled back out of prose (code, frontmatter, #tags) paints in
// --editor-font at --editor-font-size. Three story files (Editor, BlockEditor, ChatView) each
// had a verbatim copy of the prose check with the `first()` helper redefined twice; the tag
// unification added a fourth and fifth surface, which is what made this a shared module.
//
// Asserted against the LIVE tokens, never a literal family name or pixel size: hardcoding
// "CMU Serif" or 13.5 would keep passing if the token were repointed or the user changed
// appearance.editorFontSize (range 11-28), and that is the regression worth catching.
import { expect } from 'storybook/test'

/** The first family in a CSS font stack, unquoted and trimmed. */
export function firstFamily(stack: string): string {
    return stack.split(',')[0]!.replace(/["']/g, '').trim()
}

function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Assert `el` resolves to the same first family as the `--prose-font` token. */
export function expectProseFace(el: HTMLElement): void {
    const prose = token('--prose-font')
    // A missing/empty token would make the comparison vacuously true on both sides.
    expect(prose.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(prose))
}

/** Assert `el` resolves to the same first family as the `--editor-font` token. */
export function expectEditorFace(el: HTMLElement): void {
    const editor = token('--editor-font')
    expect(editor.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(editor))
}

/** Assert `el` renders at exactly `--editor-font-size`, not a scaled multiple of it. */
export function expectEditorSize(el: HTMLElement): void {
    const px = parseFloat(token('--editor-font-size'))
    expect(Number.isFinite(px) && px > 0).toBe(true)
    expect(parseFloat(getComputedStyle(el).fontSize)).toBe(px)
}
