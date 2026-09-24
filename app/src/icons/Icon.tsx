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
// The 140 canonical names resolve synchronously (see registry.ts). Any other
// name — a note's `icon: Books`, picked from the full Phosphor library — resolves
// once iconLibrary.ts has loaded that library; until then it draws an EMPTY box of
// the same size (never the fallback), and re-renders when the load lands. Cases:
//   1. `value` (or `fallback`) is a known name -> its Phosphor SVG (or a
//      hand-authored custom mark).
//   1b. A name outside the 140 while the library is loading -> an empty box.
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
    isPendingIconName,
    FALLBACK_ART,
    type IconArt,
} from './registry'
import { iconLibraryState, loadIconLibrary } from './iconLibrary'
import Text from '../ui/Text'
import iconSize from '../ui/iconSize'

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

/** Drawn while a library icon loads: the box keeps its size, nothing inside it. */
const PENDING_ART: IconArt = { kind: 'glyph', text: '' }

export const Icon: Component<IconProps> = props => {
    const spec = () => {
        const v = props.value?.trim()
        return v ? v : (props.fallback ?? '')
    }
    const art = (): IconArt => {
        const s = spec()
        // Tracked so a name that was pending re-resolves the moment the library lands.
        const library = iconLibraryState()
        const known = resolveIcon(s)
        if (known) return known
        // A name outside the 140 while the full library is still loading: an empty box of the
        // right size, not a flash of the dashed "?" (see iconLibrary.ts).
        if (library !== 'failed' && isPendingIconName(s)) {
            void loadIconLibrary()
            return PENDING_ART
        }
        // A name-shaped spec that isn't mapped reads as an unresolved icon, not a literal glyph —
        // show the generic fallback rather than the (broken-looking) raw name text.
        return looksLikeIconName(s) ? FALLBACK_ART : { kind: 'glyph', text: s }
    }
    /* The ONE icon size — `appearance.iconSize` via ui/iconSize.ts (12px default, picked
       2026-09-24: *"we should just have one size i feel no?"*). This default is what actually
       enforces it: no call site passes `size`, and ui/iconSizeLint.test.ts refuses a literal one
       unless it carries an `icon-size-exempt:` comment (an oversized illustration mark). */
    const size = () => props.size ?? iconSize()
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
        <Text
            as="span"
            size="inherit"
            tone="inherit"
            weight="inherit"
            class={props.class}
            aria-hidden="true"
            style={boxStyle()}
        >
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
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        style={{
                            'font-size': `${Math.round(size() * 0.85)}px`,
                            'white-space': 'nowrap',
                        }}
                    >
                        {a.text}
                    </Text>
                )
            })()}
        </Text>
    )
}
