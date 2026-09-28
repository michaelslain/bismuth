import { Show, type JSX } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import type { Row } from '../../../core/src/bases/types'
import { isLink, type Link } from '../../../core/src/bases/values'
import type { BaseConfig } from '../../../core/src/bases/types'
import { isTagColumn } from './columnKinds'
import { linkLabel } from './kanbanMeta'
import PropertyDisplay from './PropertyDisplay'
import { renderTags } from './valueRenderers'
import Text from '../ui/Text'
import styles from './renderValue.module.css'
import NoteLink from '../ui/NoteLink'

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
