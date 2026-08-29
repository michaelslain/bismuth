// app/src/icons/Icon.tsx
//
// The one component every call site uses to show an icon. Pass a `value` (a
// canonical icon name, the legacy "Li"/"Lu" convention, or an emoji/arbitrary
// glyph) and it renders the mapped art — this is what lets a note's
// `icon: 🪶` keep showing the feather while `icon: House` renders the app's
// own icon for it. Same component API as before the Phosphor migration
// (value/size/class/style/fallback), so the ~100 existing call sites are
// unchanged; only the rendering moved underneath it.
//
// Resolution is synchronous (see registry.ts) — one static map built from a
// generated JSON manifest, not a lazily-loaded one — so there's no pending/
// placeholder state to render while a chunk loads. Three cases, in order:
//   1. `value` (or `fallback`) is a known name -> its Phosphor SVG (or a
//      hand-authored custom mark, or the deliberate fallback for a genuine
//      Phosphor gap — see registry.ts's FALLBACK_ART).
//   2. It LOOKS like an icon name but isn't mapped at all (e.g. a legacy icon
//      name from old vault frontmatter) -> the same generic fallback, never
//      the literal name text (which would just read as a typo on screen).
//   3. Anything else (an emoji, an arbitrary glyph) -> passed through as-is.
//
// EVERY NAMED ICON IS NOW ONE SQUARE SVG FROM ONE SET (Phosphor Regular). The
// `IconArt` union keeps a `glyph` member for exactly this reason: case 3 above
// still hands this component arbitrary text, and reintroducing a typed-glyph
// icon SET later (a mix, or a full reversion) is then a data change to the
// manifest, not a renderer rewrite — `<Icon>` already has both branches.
//
// THE MULTI-CELL BOX INVARIANT IS GONE, DELIBERATELY, NOT PORTED. The old
// `isWide` grew the box for a multi-character ASCII mark (`[ ]`, `<<`, `.*`...)
// that would otherwise wrap to a second row inside a one-row box — that was a
// live bug (the chat Stop button split across two lines). Every NAMED icon is
// now a single square SVG, so that failure mode cannot recur for a name; the
// only remaining multi-character case is raw pass-through text (case 3), and
// per the migration decision it simply sits inside the same fixed box as
// everything else rather than carrying its own widening logic forward.
import { type Component, type JSX } from 'solid-js'
import {
    resolveIcon,
    looksLikeIconName,
    FALLBACK_ART,
    type IconArt,
} from './registry'

export interface IconProps {
    /** Icon name (any casing, optional Li/Lu prefix) OR an emoji / arbitrary string. */
    value: string | null | undefined
    /** Pixel size of the icon's box (default 16). */
    size?: number
    /** Accepted for API compatibility with the old SVG-backed Icon; glyphs have no stroke. */
    strokeWidth?: number
    /** Applied to the icon's wrapping span. */
    class?: string
    /** Inline style applied to the icon's wrapping span. */
    style?: JSX.CSSProperties
    /** Used when `value` is empty/null (resolved the same way as `value`). */
    fallback?: string
}

export const Icon: Component<IconProps> = props => {
    const spec = () => {
        const v = props.value?.trim()
        return v ? v : (props.fallback ?? '')
    }
    const art = (): IconArt => {
        const s = spec()
        const known = resolveIcon(s)
        if (known) return known
        // A name-shaped spec that isn't mapped reads as an unresolved icon, not a literal glyph —
        // show the generic fallback rather than the (broken-looking) raw name text.
        return looksLikeIconName(s) ? FALLBACK_ART : { kind: 'glyph', text: s }
    }
    /* 14, not 16 — the ONE icon size (visual-unification audit §9.5, `--icon: 14px`). The user's
       decision was explicit: *"we should just have one size i feel no?"*, so there is no --icon-sm
       or --icon-lg and nothing should be passing `size` at all. This default is the thing that
       actually enforces it: wave 3 swept the call sites, but a default of 16 meant every call site
       that passed NOTHING silently rendered the old size, which is how ui-button--icon-states and
       PaneHeader were still measuring 16 and 13/12 after the sweep. Keep it in step with
       ui/IconButton.tsx's ICON_PX, which is the same number for the same reason. */
    const size = () => props.size ?? 14
    const boxStyle = (): JSX.CSSProperties => ({
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        'flex-shrink': 0,
        width: `${size()}px`,
        height: `${size()}px`,
        'line-height': 1,
        ...props.style,
    })
    return (
        <span class={props.class} aria-hidden="true" style={boxStyle()}>
            {(() => {
                const a = art()
                if (a.kind === 'svg')
                    return (
                        <svg
                            width={size()}
                            height={size()}
                            viewBox={a.viewBox}
                            fill="currentColor"
                            style={{ display: 'block' }}
                            // Manifest bodies are generated (build-icon-svgs.ts) or hand-authored in
                            // this repo (registry.ts's FALLBACK_ART, iconMap.ts's custom marks) —
                            // never user-supplied — so this is trusted markup, not user input.
                            // eslint-disable-next-line solid/no-innerhtml
                            innerHTML={a.body}
                        />
                    )
                // Case 3: raw pass-through text (an emoji, or any other arbitrary glyph). Not from
                // the icon font any more — that font is retired from this component — so this rides
                // whatever the surrounding UI font stack resolves it to (system emoji fallback
                // included), same as any other text on the page.
                return (
                    <span
                        style={{
                            'font-size': `${Math.round(size() * 0.85)}px`,
                            'white-space': 'nowrap',
                        }}
                    >
                        {a.text}
                    </span>
                )
            })()}
        </span>
    )
}
