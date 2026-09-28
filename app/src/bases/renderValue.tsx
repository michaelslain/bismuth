import { For, Show, type JSX } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import type { Row } from '../../../core/src/bases/types'
import { isLink, type Link } from '../../../core/src/bases/values'
import type { BaseConfig } from '../../../core/src/bases/types'
import { renderInline, hasInlineMarkup } from './markdown'
import { isTagColumn } from './columnKinds'
import { linkLabel } from './kanbanMeta'
import PropertyDisplay from './PropertyDisplay'
import Stars from '../ui/Stars'
import { StatusText } from '../ui/StatusDot'
import Tag from '../ui/Tag'
import Text from '../ui/Text'
import styles from './renderValue.module.css'
import EmptyValue from '../ui/EmptyValue'
import NoteLink from '../ui/NoteLink'

/** Colored-dot + word status text (no pill). Delegates to the shared ui component. */
export function renderStatus(s: string): JSX.Element {
    return <StatusText status={s} />
}

/** A tag list as `#alpha, #beta` — each a ui/Tag, comma-separated — which is exactly how the tags
 *  field (ui/TagsField) reads while you edit it, so a cell looks the same at rest and in edit.
 *  `dense` is KanbanCard's compact meta-row sizing (chrome type size) — a flag rather than
 *  KanbanCard reaching into this module's `.tagRow` class, which would break under CSS-module
 *  hashing (each module's classes are local to it). */
export function renderTags(v: unknown, dense?: boolean): JSX.Element {
    const tags = Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]
    if (tags.length === 0) return <EmptyValue />
    return (
        <Text
            as="span"
            inherit
            class={`${styles.tagRow} ${dense ? styles.tagRowDense : ''}`}
        >
            <For each={tags}>
                {(t, i) => (
                    <>
                        <Show when={i() > 0}>{', '}</Show>
                        <Tag name={t} />
                    </>
                )}
            </For>
        </Text>
    )
}

/** Five lucide stars: filled gold up to `n`, faint outline for the rest. */
export function renderStars(n: number): JSX.Element {
    return <Stars value={n} />
}

/** First-column title cell: the label, linked to its note when it has one. */
export function renderTitle(id: string, row: Row): JSX.Element {
    const v = resolveProperty(id, row)
    // A Link value (e.g. file.asLink("quote text")) shows its display text and opens
    // its own target; otherwise stringify and open this row's note.
    // A list value must not reach `String()`: that joins with a bare `,` (`alpha,beta,gamma`),
    // which is how a tags column that happened to be the FIRST column read after an edit — the
    // same value renderCell shows as `#alpha #beta #gamma` one column over. A tag column keeps
    // renderTags' own look; any other list joins the way renderValue's generic array branch does.
    const list = !isLink(v) && Array.isArray(v) ? v.map(String) : null
    const label = isLink(v)
        ? linkLabel(v as Link)
        : list
          ? list.join(', ')
          : v == null
            ? ''
            : String(v)
    const tagged = !isLink(v) && isTagColumn(id) && label !== ''
    const content = (): JSX.Element =>
        tagged ? renderTags(v) : label || row.file.name
    const target = isLink(v) ? (v as Link).path : row.file.path
    // A row STORED in a base's own body has no note to open: `syntheticBaseFile` hands every
    // such row the BASE's path, as a write-back handle rather than a destination, so the
    // anchor offered "open the file you are already looking at". `Row.index` is the same
    // discriminator the write seam keys off (canWriteStoredRow), so the two agree by
    // construction. A Link VALUE is unaffected — it names a real destination of its own.
    const linkable = isLink(v) || !Number.isInteger(row.index)
    return (
        <Text as="span" inherit class={styles.cellTitle}>
            <Show when={linkable} fallback={<>{content()}</>}>
                <NoteLink path={target}>{content()}</NoteLink>
            </Show>
        </Text>
    )
}

/** Smart cell: a type-aware read-only display of one property (declared number / multiselect /
 * boolean / markdown per `config`, else the themed status / tags / rating renderers and the
 * generic renderValue). The first/title column is handled separately by renderTitle. */
export function renderCell(
    id: string,
    row: Row,
    dense?: boolean,
    config?: BaseConfig,
    inline?: boolean,
): JSX.Element {
    return <PropertyDisplay {...{ id, row, config, dense, inline }} />
}

/** The undeclared-value renderer: status dots, tags, stars, links, dates and plain values. */
export function renderValue(id: string, row: Row): JSX.Element {
    const v = resolveProperty(id, row)
    if (v === null || v === undefined) return <EmptyValue />

    // A Link value (from file.asLink(...), the link() function, or a link-typed column)
    // renders as a clickable note link, not "[object Object]".
    if (isLink(v)) {
        const link = v as Link
        const label = linkLabel(link)
        return <NoteLink path={link.path}>{label}</NoteLink>
    }

    if (id === 'file.name') {
        return <NoteLink path={row.file.path}>{String(v)}</NoteLink>
    }

    if (Array.isArray(v)) {
        return (
            <Text as="span" inherit>
                {v.map(x => String(x)).join(', ')}
            </Text>
        )
    }

    // Typed glyph, not an SVG check — "x" when true, blank when false (per the ASCII
    // system's renderValue rule: booleans render as text, never an icon asset).
    if (typeof v === 'boolean') {
        return (
            <Text as="span" inherit class={styles.boolCell}>
                {v ? 'x' : ''}
            </Text>
        )
    }

    if (v instanceof Date) {
        return (
            <Text as="span" inherit class={styles.dateCell}>
                {v.toISOString().slice(0, 10)}
            </Text>
        )
    }

    // Plain string/number cell. If it carries inline markup (emphasis, code, a wikilink, a
    // #tag, or `$math$`), render it through the shared inline markdown renderer so a cell
    // shows the same formatting + math as the rest of the app; otherwise keep it literal
    // (cheap, and avoids surprises on plain values).
    const s = String(v)
    if (hasInlineMarkup(s))
        return (
            <Text
                as="span"
                inherit
                class="bismuth-cell-md"
                innerHTML={renderInline(s)}
            />
        )
    return (
        <Text as="span" inherit>
            {s}
        </Text>
    )
}
