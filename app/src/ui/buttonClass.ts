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

export function buttonClass(opts: {
    kind?: ButtonKind
    state?: ButtonState
    size?: ButtonSize
    danger?: boolean
    /** Selected + a glow rim (--glow-accent) — the view's one emphasized action.
     *  Orthogonal to `state`/`danger`, same as those. At most one per view. */
    primary?: boolean
    class?: string
}): string {
    const kind = opts.kind ?? 'text'
    return joinClasses(
        'btn',
        `btn--${kind}`,
        `btn--${opts.state ?? 'normal'}`,
        opts.size && opts.size !== 'md' && kind !== 'text'
            ? `btn--${opts.size}`
            : '',
        opts.danger ? 'btn--danger' : '',
        opts.primary ? 'btn--primary' : '',
        opts.class,
    )
}
