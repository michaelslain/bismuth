import { computeViewLayouts } from '../layout-cache'
import { filterGraph } from '../visibilityFilter'
import { ok, type Handler, type RouteContext } from './context'

export default function graphRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { denyEntriesForRequest, graphCache, cfg } = ctx
    return {
        'GET /graph': async (req, __) => {
            const graph = await graphCache.get()
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterGraph(graph, denyEntries))
        },

        'GET /graph/views': async (_, __) => {
            // Compute (and cache) the 2nd/3rd-brain view layouts on demand. attachLayout omits
            // them from /graph until they exist (they're only needed when the user switches to a
            // brain mode), so the client fetches them here on that switch. Cheap on repeat once
            // cached; a later /graph then includes them too.
            const graph = await graphCache.get()
            const views = await computeViewLayouts(graph, cfg.vault)
            // Attach the computed views onto the cached graph object IN PLACE rather than
            // invalidating the cache. `graphCache.get()` returns the live cached reference, so
            // mutating `.views` makes a subsequent /graph include them too — without forcing the
            // next /graph to re-walk + re-read the whole vault. A genuine file change still calls
            // graphCache.invalidate() via applyDirty, rebuilding a fresh graph (whose views are
            // recomputed lazily on the next /graph/views), so this never serves stale layouts.
            graph.views = views
            return ok(views)
        },
    }
}
