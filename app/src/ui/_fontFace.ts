// app/src/ui/_fontFace.ts
// Story-only assertion helpers: "this element renders in the note PROSE face" and "…in the
// UI/mono face, at the code size".
//
// Note prose, chat message bodies and note tables paint in --prose-font (Lora), the ONE
// proportional exception to the app's single mono family — see CLAUDE.md's Typography note and
// global.css. Everything pulled back out of prose (code, frontmatter, #tags) paints in
// --ui-font-stack at --code-font-size. Several story files (Editor, ChatView, …) each had a
// verbatim copy of the prose check with the `first()` helper redefined; the tag unification
// added more surfaces, which is what made this a shared module.
//
// Asserted against the LIVE tokens, never a literal family name or pixel size: hardcoding
// "Lora Variable" or 13.5 would keep passing if the token were repointed or the user changed
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

/** Assert `el` resolves to the same first family as the `--ui-font-stack` token. */
export function expectUiFace(el: HTMLElement): void {
    const ui = token('--ui-font-stack')
    expect(ui.length).toBeGreaterThan(0)
    expect(firstFamily(getComputedStyle(el).fontFamily)).toBe(firstFamily(ui))
}

/** `--code-font-size` resolved to px. It is a calc() off the prose size, so `getPropertyValue`
 *  would return the raw expression — a probe element resolves it the way a real rule does. */
export function codeFontPx(): number {
    const probe = document.createElement('div')
    probe.style.fontSize = 'var(--code-font-size)'
    document.body.appendChild(probe)
    const px = parseFloat(getComputedStyle(probe).fontSize)
    probe.remove()
    return px
}

/** Assert `el` renders at exactly `--code-font-size` — the one size for mono inside prose —
 *  never the prose size and never the editor size it is derived from. */
export function expectCodeSize(el: HTMLElement): void {
    const px = codeFontPx()
    expect(Number.isFinite(px) && px > 0).toBe(true)
    expect(parseFloat(getComputedStyle(el).fontSize)).toBeCloseTo(px, 3)
}

/** A mixed-case pangram, wide enough that two genuinely different faces measure to different
 *  widths at any reasonable size — used only by expectFamilyReallyLoaded below. */
const MEASURE_PANGRAM = 'The Quick Brown Fox Jumps Over The Lazy Dog 0123456789'

/** True only if `family` genuinely resolved — a family that does not exist renders with the
 *  fallback and therefore measures identically to a nonsense family. `document.fonts.check`
 *  cannot tell those apart (it answers "is SOMETHING renderable", and says yes for a missing
 *  family, no for a registered-but-unloaded one), which is why this measures instead.
 *
 *  `document.fonts.load` runs first because a lazily-loaded (`font-display: swap`) webface is
 *  not laid out, and therefore not measurable, until something has asked for it. */
export async function expectFamilyReallyLoaded(family: string): Promise<void> {
    await document.fonts.load(`16px '${family}'`)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `16px '${family}'`
    const targetWidth = ctx.measureText(MEASURE_PANGRAM).width
    ctx.font = "16px 'Totally Nonexistent Font 12345'"
    const bogusWidth = ctx.measureText(MEASURE_PANGRAM).width
    expect(targetWidth).not.toBe(bogusWidth)
}

/** Assert `el`'s family is bound to the `--ui-font-stack` TOKEN, not merely equal to its value.
 *
 *  --ui-font-stack and --prose-font resolve to visibly different families, so a naive equality
 *  check on the resolved value would already catch most drift — but repointing the TOKEN itself
 *  is what proves the rule is actually a live `var()` reference rather than a literal that
 *  happens to match today's default. The probe name never has to exist as a real font:
 *  getComputedStyle reports the declared stack, not what the system resolved.
 *
 *  Repoints via document.documentElement.style, matching how settingsCssVars.ts's setCssVars
 *  actually writes every token (root.style.setProperty), so this reads back through the same
 *  cascade path the app itself uses. The restore is in a `finally` — a failing assertion here
 *  must not leave the probe family bound to --ui-font-stack for every story that runs after it
 *  in the same Storybook session. */
export function expectBoundToUiFont(el: HTMLElement): void {
    const root = document.documentElement
    const saved = root.style.getPropertyValue('--ui-font-stack')
    try {
        root.style.setProperty('--ui-font-stack', 'UiFontBindingProbe, monospace')
        expect(firstFamily(getComputedStyle(el).fontFamily)).toBe('UiFontBindingProbe')
    } finally {
        if (saved) root.style.setProperty('--ui-font-stack', saved)
        else root.style.removeProperty('--ui-font-stack')
    }
}
