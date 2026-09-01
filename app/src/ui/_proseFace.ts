// app/src/ui/_proseFace.ts
// Story-only assertion helper: "this element renders in the note PROSE face".
//
// Note prose, chat message bodies and note tables all paint in --prose-font (CMU Serif), the ONE
// proportional exception to the app's single mono family — see CLAUDE.md's Typography note and
// styles/tokens.css. Three story files (Editor, BlockEditor, ChatView) each had a verbatim copy of
// this check with the `first()` helper redefined twice; a fourth surface (Editor's DenseTable)
// made that a real duplication rather than a coincidence.
//
// Asserted against the LIVE --prose-font token, never a literal family name: hardcoding "CMU
// Serif" would keep passing if the token were repointed, which is the regression worth catching.
import { expect } from 'storybook/test'

/** The first family in a CSS font stack, unquoted and trimmed. */
export function firstFamily(stack: string): string {
    return stack.split(',')[0]!.replace(/["']/g, '').trim()
}

/** Assert `el` resolves to the same first family as the `--prose-font` token. */
export function expectProseFace(el: HTMLElement): void {
    const prose = getComputedStyle(document.documentElement)
        .getPropertyValue('--prose-font')
        .trim()
    // A missing/empty token would make the comparison vacuously true on both sides.
    expect(prose.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(prose))
}
