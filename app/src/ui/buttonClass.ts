// pure class-string composition for the ui/ button family.
//
// Buttons have two axes:
//   • kind  — "text" (the "[ label ]" bracket look, lowercase, one size) |
//             "icon" (a borderless icon button) | "segment" (the OLD "text" look —
//             uppercase, bordered, sized — kept verbatim for SegmentedToggle only)
//   • state — the selection role of the button:
//       "normal"     standalone button, not part of any group (default)
//       "unselected" a member of a toggle/series that is currently OFF (de-emphasized)
//       "selected"   a member that is currently ON (accent-highlighted)
//     For icon buttons, "normal" looks like "unselected" but at full opacity.
// `danger` is an orthogonal tone (destructive actions) layered on any state.
// `primary` is a second orthogonal tone: selected + a glow rim — the view's one
// emphasized action (max one per view; text buttons only).
// `size` is ignored for `kind: 'text'` — every text button renders at one size
// (--fs-ui). `icon` and `segment` still take sm/md/lg.
export type ButtonKind = 'text' | 'icon' | 'segment'
export type ButtonState = 'normal' | 'selected' | 'unselected'
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Join class-name parts, dropping falsy entries. Shared by every assembler below. */
function joinClasses(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ')
}

/** Maps each logical class key ('btn', 'btn--text', 'btn--selected', 'btn--sm', 'btn--danger',
 *  'btn--primary', …) to the hashed local Button.module.css exports it under. */
export type ButtonClassMap = Readonly<Record<string, string>>

/** Maps each logical class key ('btn', 'btn--text', 'btn--selected', 'btn--sm', 'btn--danger',
 *  'btn--primary', …) through `cls`, so Button.tsx passes its CSS-module `styles` and the output
 *  is hashed. `cls` is REQUIRED: no literal class name ever reaches the DOM. A key missing from
 *  `cls` is dropped rather than emitted as a literal. */
export function buttonClass(
    opts: {
        kind?: ButtonKind
        state?: ButtonState
        size?: ButtonSize
        danger?: boolean
        /** Selected + a glow rim (--glow-accent) — the view's one emphasized action.
         *  Orthogonal to `state`/`danger`, same as those. At most one per view. */
        primary?: boolean
        class?: string
    },
    cls: ButtonClassMap,
): string {
    const kind = opts.kind ?? 'text'
    return joinClasses(
        cls['btn'],
        cls[`btn--${kind}`],
        cls[`btn--${opts.state ?? 'normal'}`],
        opts.size && opts.size !== 'md' && kind !== 'text'
            ? cls[`btn--${opts.size}`]
            : '',
        opts.danger ? cls['btn--danger'] : '',
        opts.primary ? cls['btn--primary'] : '',
        opts.class,
    )
}
