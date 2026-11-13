// How a ```query block's own keys combine with the view config of the base it points at.
// A plain module: no framework imports.
import type { QueryBlock, ViewConfig } from './types'

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
