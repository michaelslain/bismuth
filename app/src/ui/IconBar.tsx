import { splitProps, type Component, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import Band, { type BandProps } from './Band'
import { IconBarContext } from './iconBarContext'
import iconSize from './iconSize'
import styles from './IconBar.module.css'

// The unified icon-toolbar primitive (toolbar-iconbar plan). The icon toolbars that share one
// bracket spacing, button box, glyph size and band height compose this instead of bespoke layout
// CSS: the sidebar row, the tab-rail action row, the mini-graph mode switcher, the kanban column
// header and the flashcards bar (five files today; other icon rows still hand-write their own
// flex and are being moved onto `bare` below). It reaches its `IconButton` children through Solid
// context only (never a class selector or `:global()`) — see iconBarContext.ts and
// Button.module.css's `--iconbar-*` reads.
//
// `bare` is the plain run of icon buttons: just the `--bar-icon-gap` between them. It sets no
// role="toolbar", takes no label, and forces no icon size or button box on its children, so a row
// that only wanted `display: flex; gap` composes this instead of writing the pair by hand.
type IconBarCommon = {
    children: JSX.Element
    /** 'row' (default): one flex line, var(--sp-1) between buttons (var(--bar-icon-gap) when `bare`).
     *  'wrap': wraps onto more lines, centred, zero row gap (the collapsed tab rail's stacked icons). */
    layout?: 'row' | 'wrap'
    /** 'row' (default) | 'column' — stack the buttons vertically at the same gap (a map's zoom
     *  controls). A toolbar in a column also reports aria-orientation="vertical". Wins over
     *  `layout="wrap"`, which is a row-only arrangement. */
    direction?: 'row' | 'column'
    /** true: render through ui/Band — the chrome band (--h-band, --sp-5 side padding, --rule-soft
     *  hairline) that ViewBar shares. false (default): an inline group inside another bar, e.g. a
     *  ViewBar slot. Ignored when `bare`. */
    band?: boolean
    /** Glyph px for every IconButton inside. Default iconSize() — the app's one icon size. Stories pass it; app code never does. Ignored when `bare`. */
    iconSize?: number
    /** With `band`: which edge carries the hairline, forwarded to Band's `rule`. Default 'bottom'. */
    bandRule?: 'top' | 'bottom'
    /** With `band`: a NAMED extra start inset, forwarded to Band's `inset` (`rail` for the mirrored
     *  tab rail), so a toolbar never hand-writes its own padding. */
    bandInset?: BandProps['inset']
    /** With `band`: vertical room for a wrapping bar's stacked icons, forwarded to Band's `padBlock`. */
    bandPadBlock?: boolean
    class?: string
}
export type IconBarProps = (
    | {
          /** Accessible name; the root is role="toolbar". */
          label: string
          /** No toolbar semantics, no label, no forced icon size — just the gap. */
          bare?: false
      }
    | { label?: undefined; bare: true }
) &
    IconBarCommon &
    Omit<
        JSX.HTMLAttributes<HTMLDivElement>,
        'children' | 'class' | 'role' | 'aria-label'
    >

const IconBar: Component<IconBarProps> = props => {
    // `style` is destructured out (not left in `rest`) so a caller-supplied style object merges
    // with `--iconbar-glyph` instead of a later `{...rest}` spread silently replacing the whole
    // style attribute and losing it — Solid's JSX applies attributes in the order written, and a
    // plain object spread would win over the explicit `style` above it.
    const [local, rest] = splitProps(props, [
        'children',
        'label',
        'bare',
        'layout',
        'direction',
        'band',
        'iconSize',
        'bandRule',
        'bandInset',
        'bandPadBlock',
        'class',
        'style',
    ])
    const glyph = () => local.iconSize ?? iconSize()
    const style = (): JSX.CSSProperties | string | undefined => {
        if (local.bare) return local.style
        const vars = { '--iconbar-glyph': `${glyph()}px` }
        if (!local.style) return vars
        if (typeof local.style === 'string') {
            return `${local.style};--iconbar-glyph:${glyph()}px`
        }
        return { ...local.style, ...vars }
    }
    // A bare bar publishes no context, so its IconButtons keep their standalone size and box.
    const column = () => local.direction === 'column'
    return (
        <IconBarContext.Provider
            value={local.bare ? undefined : { iconSize: glyph }}
        >
            {/* A `band` bar renders through ui/Band, the one definition of the chrome band's
                height, side padding and hairline (shared with ViewBar). */}
            <Dynamic
                component={local.band && !local.bare ? Band : 'div'}
                role={local.bare ? undefined : 'toolbar'}
                aria-orientation={
                    !local.bare && column() ? 'vertical' : undefined
                }
                rule={local.band && !local.bare ? local.bandRule : undefined}
                inset={local.band && !local.bare ? local.bandInset : undefined}
                padBlock={local.band && !local.bare ? local.bandPadBlock : undefined}
                aria-label={local.bare ? undefined : local.label}
                class={[
                    local.bare ? styles.bare : styles.bar,
                    local.layout === 'wrap' && styles.wrap,
                    column() && styles.column,
                    local.class,
                ]
                    .filter(Boolean)
                    .join(' ')}
                style={style()}
                {...rest}
            >
                {local.children}
            </Dynamic>
        </IconBarContext.Provider>
    )
}

export default IconBar
