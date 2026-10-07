// The leaf value renderers: status, tags, stars and the undeclared-value `renderValue`. Nothing
// here imports PropertyDisplay, so PropertyDisplay can build on these without an import cycle
// (renderValue.tsx -> PropertyDisplay -> renderValue.tsx before this module existed).
import { For, Show, type JSX } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import type { Row } from '../../../core/src/bases/types'
import { isLink, type Link } from '../../../core/src/bases/values'
import { renderInline, hasInlineMarkup } from './markdown'
import { linkLabel } from './kanbanMeta'
import Stars from '../ui/Stars'
import { StatusText } from '../ui/StatusDot'
import Tag from '../ui/Tag'
import Text from '../ui/Text'
import EmptyValue from '../ui/EmptyValue'
import BooleanValue from './BooleanValue'
import { formatDateValue, isEmptyValue, looksLikeDatetime } from './valueDisplay'
import NoteLink from '../ui/NoteLink'
import styles from './valueRenderers.module.css'

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

/** The undeclared-value renderer: status dots, tags, stars, links, dates and plain values. */
export function renderValue(id: string, row: Row): JSX.Element {
    const v = resolveProperty(id, row)
    if (isEmptyValue(v)) return <EmptyValue />

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

    // One boolean spelling everywhere: the `[ ]` / `[x]` glyph (BooleanValue).
    if (typeof v === 'boolean') return <BooleanValue value={v} />

    // A stored datetime reads `2026-09-14 14:00`, as the date editor's trigger does.
    if (looksLikeDatetime(v)) {
        return (
            <Text as="span" inherit class={styles.dateCell}>
                {formatDateValue(v, true)}
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
