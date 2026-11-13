// How a ```query block's own keys combine with the view config of the base it points at.
// A plain module: no framework imports.
import { combineFilters } from './filters'
import type { BaseConfig, QueryBlock, ViewConfig } from './types'

/** The base's view config with the block's keys laid over it. The block's `sort`, `group` and
 *  `limit` win when written; its layout (`as`) wins only when the block wrote a `view:` itself
 *  (`layoutGiven`), so a block that just says `of: [[Habits]]` draws the base the way the base
 *  is configured: same layout, same `x`/`y`/`aggregate`. Every other key of the base's view
 *  (axes, columns, summaries, ...) passes through untouched. */
export function mergeQueryView(base: ViewConfig, block: QueryBlock): ViewConfig {
    return {
        ...base,
        type: block.layoutGiven ? block.as : base.type,
        sort: block.sort ?? base.sort,
        groupBy: block.group ? { property: block.group } : base.groupBy,
        limit: block.limit ?? base.limit,
    }
}

/** A ```query block written as a base config (`source: base` + `ref: [[Base]]`) drawn over the
 *  base it points at, the way an `of:` block is: the base's view config (layout, `x`, `y`,
 *  `aggregate`, columns, ...), filters, formulas and properties stay, and every key the block
 *  wrote lays over them. Its layout wins only when it wrote one (`layoutGiven`); its filters AND
 *  with the base's; its own `source` replaces the base's. */
export function mergeQueryConfig(
    base: BaseConfig,
    block: BaseConfig,
    layoutGiven: boolean,
): BaseConfig {
    const written = Object.fromEntries(
        Object.entries(block.view).filter(([, v]) => v !== undefined),
    )
    return {
        ...base,
        formulas: base.formulas || block.formulas ? { ...base.formulas, ...block.formulas } : undefined,
        properties:
            base.properties || block.properties
                ? { ...base.properties, ...block.properties }
                : undefined,
        declaredProperties: block.declaredProperties ?? base.declaredProperties,
        schema: block.schema || base.schema ? { ...base.schema, ...block.schema } : undefined,
        categories: block.categories ?? base.categories,
        view: {
            ...base.view,
            ...written,
            type: layoutGiven ? block.view.type : base.view.type,
        },
        filters: combineFilters(base.filters, block.filters),
        source: block.source,
    }
}
