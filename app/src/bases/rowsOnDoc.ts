// Lays a base's resolved rows over the document on screen now.
//
// A base resolves in two steps: the document (the file's config and own rows) and the rows its
// source produced. The rows step copies the document into its result, and its resource is keyed
// on the base's identity and source alone. When a base mounts from a stale cached document (a tab
// switched back to after the file changed on disk), the rows step starts from that stale copy;
// the fresh document then lands with the same key, the rows are never fetched again, and the
// view kept drawing the old columns. Taking the config, base path and own rows from the current
// document keeps them in step without another round trip: the rows a source resolved depend only
// on the source, which is part of the rows key, while everything the config says (columns, sort,
// filters, widths) is applied client-side.
import type { BaseConfig, Row, SourceSpec } from '../../../core/src/bases/types'

export type BaseDoc = {
    config: BaseConfig
    rows: Row[]
    basePath?: string
    refOwnsRows?: boolean
}

export type ResolvedRows = BaseDoc & { spec?: SourceSpec }

/** `resolved` with the config, base path and own rows read from `doc`. Returns `resolved` itself
 *  when nothing differs, so a memo over it keeps its identity. */
export default function rowsOnDoc<T extends ResolvedRows>(
    resolved: T | undefined,
    doc: BaseDoc | undefined,
): T | undefined {
    if (!resolved || !doc) return resolved
    const ownRows = resolved.spec?.kind === 'base' && !resolved.spec.ref
    const rows = ownRows ? doc.rows : resolved.rows
    if (
        resolved.config === doc.config &&
        resolved.basePath === doc.basePath &&
        resolved.refOwnsRows === doc.refOwnsRows &&
        resolved.rows === rows
    )
        return resolved
    return {
        ...resolved,
        config: doc.config,
        basePath: doc.basePath,
        refOwnsRows: doc.refOwnsRows,
        rows,
    }
}
