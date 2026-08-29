// app/src/icons/specimen/SvgIcon.tsx
//
// Renders one resolved IconBody (see iconSetData.ts): an inlined Iconify SVG body, a Nerd Font
// glyph character, or — when the set has a genuine gap for this name — a visible MISSING marker.
// This is specimen-only scaffolding, not a replacement for the real app's <Icon> (app/src/icons/
// Icon.tsx), which stays untouched: nothing here is wired into a real call site.
import type { Component } from 'solid-js'
import type { IconBody } from './iconSetData'
import styles from './SvgIcon.module.css'

export type SvgIconProps = {
    body: IconBody | null
    /** Pixel size (both width and height — every icon in the specimen is square). */
    size: number
    class?: string
    title?: string
}

/**
 * One glyph, at one size, from one resolved body. `body === null` means the set genuinely has no
 * art for this name — rendered as a visible dashed-box marker (never hidden, never a fabricated
 * standin) so a gap in the record reads as a gap, not as an empty cell that looks like a bug.
 */
const SvgIcon: Component<SvgIconProps> = props => {
    return (
        <>
            {props.body === null ? (
                <span
                    class={[styles.missing, props.class]
                        .filter(Boolean)
                        .join(' ')}
                    style={{
                        width: `${props.size}px`,
                        height: `${props.size}px`,
                        'font-size': `${props.size * 0.6}px`,
                    }}
                    title={props.title ?? 'missing'}
                    aria-label="missing icon"
                >
                    ?
                </span>
            ) : props.body.kind === 'glyph' ? (
                <span
                    class={[styles.glyph, props.class]
                        .filter(Boolean)
                        .join(' ')}
                    style={{
                        width: `${props.size}px`,
                        height: `${props.size}px`,
                        'font-size': `${props.size}px`,
                    }}
                    title={props.title}
                >
                    {props.body.content}
                </span>
            ) : (
                <svg
                    class={[styles.icon, props.class].filter(Boolean).join(' ')}
                    width={props.size}
                    height={props.size}
                    viewBox={props.body.viewBox}
                    fill="currentColor"
                    aria-label={props.title}
                    // eslint-disable-next-line solid/no-innerhtml
                    innerHTML={props.body.content}
                />
            )}
        </>
    )
}

export default SvgIcon
