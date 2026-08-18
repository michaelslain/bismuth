// app/src/editor/inlineEmphasis.ts
// The live-preview inline EMPHASIS pass — bold (**/__), italic (*), strikethrough (~~) — plus
// the two shared "reveal" marks every hidden/revealed delimiter uses (`hide` / `syntaxMark`).
// Extracted from livePreview.ts so the pass is importable under `bun test` (livePreview pulls
// in Solid .tsx that bun's test transform can't compile — the same constraint that shaped
// tableWidget.test.ts). livePreview re-imports everything here; behavior is identical except
// for the #58 fix documented on `pushInline`.
import { Decoration } from '@codemirror/view'
import type { Range } from '@codemirror/state'

/** Off-cursor markdown delimiters (e.g. the `**` around bold) — display:none via CSS. */
export const hide = Decoration.mark({ class: 'cm-hidden-syntax' })
/** On-cursor (revealed) delimiters — dim Monaspace instead of the prose serif. */
export const syntaxMark = Decoration.mark({ class: 'cm-syntax-mark' })
export const strong = Decoration.mark({ class: 'cm-strong' })
export const em = Decoration.mark({ class: 'cm-em' })
export const strike = Decoration.mark({ class: 'cm-strike' })

// Emphasis token regexes (module-scope so no per-line re-allocation; see livePreview's
// regex-hoisting comment). matchAll never leaks lastIndex for these.
export const STRONG_STAR_RE = /\*\*([^*]+)\*\*/g
export const STRONG_UNDERSCORE_RE = /__([^_]+)__/g
export const EM_RE = /(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g
export const STRIKE_RE = /~~([^~]+)~~/g

/** Hide the delimiters of an inline token (off the cursor line) and style the inner text.
 *
 *  `skip` guards markdown emphasis against `*`/`_`/`~` that live inside `$…$` (those are
 *  LaTeX, not markdown). #58: the guard tests only the two DELIMITER runs, not the whole
 *  token — a bold/italic span whose delimiters sit in prose but whose inner text CONTAINS a
 *  math span (e.g. `**Case 1: $hk \in H$.**`) is a legitimate emphasis token and must render
 *  (markers hidden, `cm-strong` on the text, the math widget untouched — a mark decoration
 *  may overlap a replace decoration). Only when a delimiter itself overlaps math (e.g. the
 *  `*b*` inside `$a *b* c$`, or `**a $b** c$` whose closer is mid-math) is the token skipped. */
export function pushInline(
    deco: Range<Decoration>[],
    text: string,
    lineFrom: number,
    reveals: (from: number, to: number) => boolean,
    re: RegExp,
    markLen: number,
    mark: Decoration,
    skip?: (from: number, to: number) => boolean,
) {
    for (const m of text.matchAll(re)) {
        const s = lineFrom + (m.index ?? 0)
        const end = s + m[0].length
        const innerStart = s + markLen,
            innerEnd = end - markLen
        if (innerEnd <= innerStart) continue
        // Skip only when a DELIMITER overlaps a protected (math) span — see the doc comment.
        if (skip && (skip(s, innerStart) || skip(innerEnd, end))) continue
        // Reveal raw syntax only when the caret/selection touches THIS token — not the
        // whole line. So `**bold** *italic*` reveals only the span the cursor is inside.
        const onCursor = reveals(s, end)
        deco.push(mark.range(innerStart, innerEnd))
        if (!onCursor) {
            deco.push(hide.range(s, innerStart))
            deco.push(hide.range(innerEnd, end))
        } else {
            // Revealed: the delimiters render in dim Monaspace, not the prose serif.
            deco.push(syntaxMark.range(s, innerStart))
            deco.push(syntaxMark.range(innerEnd, end))
        }
    }
}

/** The full emphasis pass for one line — the exact token set + order livePreview applies.
 *  Shared with the mounted-EditorView tests so they exercise the same composition. */
export function pushEmphasis(
    deco: Range<Decoration>[],
    text: string,
    lineFrom: number,
    reveals: (from: number, to: number) => boolean,
    skip?: (from: number, to: number) => boolean,
) {
    pushInline(deco, text, lineFrom, reveals, STRONG_STAR_RE, 2, strong, skip)
    pushInline(
        deco,
        text,
        lineFrom,
        reveals,
        STRONG_UNDERSCORE_RE,
        2,
        strong,
        skip,
    )
    pushInline(deco, text, lineFrom, reveals, EM_RE, 1, em, skip)
    pushInline(deco, text, lineFrom, reveals, STRIKE_RE, 2, strike, skip)
}
