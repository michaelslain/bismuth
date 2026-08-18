// app/src/graph/labelSelection.ts
// Pure label-ladder math for the renderer: which nodes get a permanent label regardless of camera
// state, and how cluster/file names crossfade across the zoom ladder.
// Combines top-degree hubs with the currently-open file.
// Pure (no DOM, no canvas) so it can be unit-tested directly.

type NodeLike = { id: string; kind: string }
type EdgeEndpoint = string | { id: string }
type EdgeLike = { source: EdgeEndpoint; target: EdgeEndpoint }

function endpointId(e: EdgeEndpoint): string {
    return typeof e === 'object' ? e.id : (e as string)
}

/**
 * Return the union of: top-`hubCount` nodes by edge degree and `activeFile` (if present and in the
 * node list). Ties in degree are broken by id (lexicographically ascending) so the choice is
 * deterministic across renders.
 *
 * Degree is computed as undirected degree (total connections, in or out — counts both source and target).
 */
export function computeAlwaysOnSet(
    nodes: NodeLike[],
    edges: EdgeLike[],
    activeFile: string | null,
    hubCount: number,
): Set<string> {
    const result = new Set<string>()
    if (nodes.length === 0) return result
    const nodeIds = new Set(nodes.map(n => n.id))

    // Active file, if it actually exists in the graph.
    if (activeFile && nodeIds.has(activeFile)) result.add(activeFile)

    // Top-N by undirected degree.
    if (hubCount > 0) {
        const deg = new Map<string, number>()
        for (const n of nodes) deg.set(n.id, 0)
        for (const e of edges) {
            const s = endpointId(e.source)
            const t = endpointId(e.target)
            if (deg.has(s)) deg.set(s, (deg.get(s) ?? 0) + 1)
            if (deg.has(t)) deg.set(t, (deg.get(t) ?? 0) + 1)
        }
        const ranked = nodes
            .map(n => ({ id: n.id, d: deg.get(n.id) ?? 0 }))
            .sort((a, b) => b.d - a.d || a.id.localeCompare(b.id))
        for (let i = 0; i < Math.min(hubCount, ranked.length); i++) {
            result.add(ranked[i].id)
        }
    }

    return result
}

// ---------------------------------------------------------------------------
// 2D rendered-size label gating (no permanent hubs, no radius-from-center).
// ---------------------------------------------------------------------------
// Zoom-driven label MODE: below a reveal point the field names CLUSTERS, not files — file names
// crossfade in (and their per-frame budget ramps up) only as the camera keeps zooming in. All of
// this is keyed off the same continuous "t" AsciiGraphRenderer already computes for its 0–100%
// resolution readout (see asciiGrid.ts `resolutionT`): 0 = fully zoomed out (res = 1, the whole
// graph fit to the grid), 1 = max resolution. Pure so the curve shape can be tuned + pinned here
// without touching the renderer or a canvas.
// ---------------------------------------------------------------------------

/** t below which NO file label is drawn (forced ones — hover/active/search — are the only
 *  exception; see AsciiGraphRenderer's `forced()`). Cluster names own the field down here, and node
 *  COLOR reads by the coarser end of the hierarchy too (AsciiGraphRenderer's LEVEL-DRIVEN COLOR
 *  block keys its active level off this same boundary math). When LOD masses are opted into
 *  (GraphConfig.showLodMasses, off by default — see lod.ts) they key their GEOMETRY off the same
 *  boundary too: aggregate cluster ENTITIES own the field down here and real notes/edges only
 *  rasterize past this point; in the shipped default (masses off) real notes/edges rasterize at
 *  EVERY zoom stop instead — only the LABELS and node COLOR are what change at this boundary.
 *
 *  0.75, was 0.6 (and 0.3 before the LOD redesign): "to show the notes inside a cluster the user
 *  should have to zoom in MORE than now". Because the ladder is logarithmic in resolution
 *  (`resFromT` = maxRes^t), moving the boundary from 0.6 to 0.75 is not a 25% change — on the
 *  reference vault (maxRes 68 at the current `DEEPEST_WORLD_PER_CELL`) the leaves now first appear at
 *  res 23.8 instead of res 8.2, i.e. at 2.9× the magnification, and they only OWN the field from the
 *  10% stop. Aggregate entities (when opted into) own 100%..20% (was 100%..40%).
 *
 *  Everything downstream is derived, not duplicated: `levelBoundaries` re-spreads the hierarchy
 *  levels evenly across [0, this) — on a 3-level vault, 0.25 per level instead of 0.2 — and
 *  `lodMix` keys the (opt-in) entity/leaf geometry off the same two curves as the names, exactly as
 *  AsciiGraphRenderer's node-color block keys its level pick off `clusterLevelAlphas`. */
export const FILE_LABEL_REVEAL_T = 0.75
/** Width (in the same t units) of the cluster-name → file-name crossfade that starts at
 *  `FILE_LABEL_REVEAL_T`. 0.15, was 0.22: it has to finish BEFORE `FILE_LABEL_FULL_T` (see there —
 *  the budget is meant to keep climbing after the crossfade is done), and with the reveal point at
 *  0.75 the old 0.22 would have run to 0.97, past it. 0.15 keeps the same ~60% share of the
 *  post-reveal span the old pair had. */
export const FILE_LABEL_FADE_SPAN = 0.15
/** t at which the file-label BUDGET (as opposed to the crossfade alpha above) reaches "every
 *  on-grid candidate". Deliberately later than the crossfade finishes — the crossfade is about
 *  visibility, the budget is about density, and "full naming only near max resolution" means the
 *  budget keeps climbing well after files have fully faded in. */
export const FILE_LABEL_FULL_T = 0.94
/** Shape of the budget ramp: `u ** power`, power > 1 → slow-then-fast. Right after the reveal
 *  point only the highest-ranked (hub) candidates clear a budget of 1–2; the ramp only opens up
 *  approaching `FILE_LABEL_FULL_T`. */
export const FILE_LABEL_BUDGET_POWER = 2.6

/**
 * How many non-forced file labels the field may draw at zoom fraction `t`, out of
 * `totalCandidates` on-grid nodes. Zero at/below `revealT`. Grows as `((t - revealT) /
 * (fullT - revealT)) ** power` beyond that — small for a while after the reveal point (letting
 * only genuine hubs, which are ranked first by the caller, name themselves early) and only
 * approaching `totalCandidates` near `fullT`.
 */
export function fileLabelBudget(
    t: number,
    totalCandidates: number,
    revealT: number = FILE_LABEL_REVEAL_T,
    fullT: number = FILE_LABEL_FULL_T,
    power: number = FILE_LABEL_BUDGET_POWER,
): number {
    if (totalCandidates <= 0 || t <= revealT) return 0
    const span = Math.max(1e-6, fullT - revealT)
    const u = Math.max(0, Math.min(1, (t - revealT) / span))
    return Math.round(Math.pow(u, power) * totalCandidates)
}

/** Minimum cluster-name budget, whatever the pane's row count — a tiny panel still gets to name
 *  its biggest few communities, never zero. */
export const CLUSTER_LABEL_MIN_BUDGET = 3

/** Rows of vertical room a cluster name needs to itself, on average, before the field reads as
 *  crowded rather than merely labelled — the eyebrow lift plus a gap to the next name. Tuned
 *  against the reported failure (a ~2200-note vault, ~15-20 real communities, a small panel): at
 *  that count `clusterLabelBudget` keeps the pane down to its biggest handful of names instead of
 *  drawing every community regardless of how few rows are actually available for them. */
export const CLUSTER_LABEL_ROWS_PER_LABEL = 3

/**
 * How many cluster/entity (eyebrow) names the field may draw at once, out of `totalCandidates`
 * on-grid communities — UNLIKE `fileLabelBudget`, this has no zoom dependence: cluster names are
 * the field's ENTIRE naming at fit (before file names ever reveal), so a budget that only opens
 * with zoom would leave a small pane silently unlabelled at the exact stop where cluster names are
 * everything it has to show. Instead the budget is driven by the pane's own ROW COUNT: plenty of
 * rows names every candidate (the ladder was never the bottleneck at normal size), few rows caps it
 * to the biggest few. Callers rank candidates biggest-community-first and stop once this many have
 * actually been drawn, so a capped pane always keeps its most meaningful names, never an arbitrary
 * subset.
 */
export function clusterLabelBudget(
    rows: number,
    totalCandidates: number,
): number {
    if (totalCandidates <= 0) return 0
    const byRows = Math.floor(Math.max(0, rows) / CLUSTER_LABEL_ROWS_PER_LABEL)
    const floor = Math.min(CLUSTER_LABEL_MIN_BUDGET, totalCandidates)
    return Math.max(floor, Math.min(byRows, totalCandidates))
}

/** Smoothstep crossfade: 0 at/below `revealT`, 1 at `revealT + fadeSpan` and beyond. Drives file
 *  labels' fade-IN alpha; `clusterLabelAlpha` is its complement. */
export function fileLabelAlpha(
    t: number,
    revealT: number = FILE_LABEL_REVEAL_T,
    fadeSpan: number = FILE_LABEL_FADE_SPAN,
): number {
    if (t <= revealT) return 0
    const u = Math.max(0, Math.min(1, (t - revealT) / Math.max(1e-6, fadeSpan)))
    return u * u * (3 - 2 * u)
}

/** The complementary cluster-name alpha: clusters own the field at/below `revealT` and fade fully
 *  out once file labels have crossfaded in. */
export function clusterLabelAlpha(
    t: number,
    revealT: number = FILE_LABEL_REVEAL_T,
    fadeSpan: number = FILE_LABEL_FADE_SPAN,
): number {
    return 1 - fileLabelAlpha(t, revealT, fadeSpan)
}

// ---------------------------------------------------------------------------
// N-LEVEL cluster-name ladder: below `FILE_LABEL_REVEAL_T` (owned entirely by cluster names, see
// above) a graph with a `communityPath` deeper than one level doesn't just show ONE cluster
// tier — it walks the hierarchy coarsest → finest as the camera zooms in, one crossfade per level
// boundary, landing on the finest level exactly at `revealT` (where the two-state file-vs-cluster
// crossfade above takes over unchanged). A 1-level graph (the pre-hierarchy default, or any graph
// under the community detector's finest-only threshold) collapses to exactly the original
// single-tier behaviour: `clusterLevelAlphas(t, 1)` is `[1]` for every t below `revealT`.
// ---------------------------------------------------------------------------

/** Fraction of each level's segment spent crossfading INTO the next level (smoothstep, ending
 *  exactly at the segment's own boundary) — the rest of the segment shows that level at full
 *  strength. Mirrors `FILE_LABEL_FADE_SPAN`'s role for the outer file crossfade, sized per-segment
 *  instead of being a fixed t-width so it still fits comfortably at 4 levels. */
const LEVEL_FADE_FRAC = 0.45

/**
 * The `levelCount + 1` t-boundaries splitting `[0, revealT)` into `levelCount` even segments, one
 * per hierarchy level (coarsest → finest). `boundaries[i]` is where level `i` starts owning the
 * field; `boundaries[levelCount] === revealT`, where the outer file crossfade takes over.
 */
export function levelBoundaries(
    levelCount: number,
    revealT: number = FILE_LABEL_REVEAL_T,
): number[] {
    const n = Math.max(1, levelCount)
    const seg = revealT / n
    return Array.from({ length: n + 1 }, (_, i) => i * seg)
}

function smoothstep01(u: number): number {
    const c = Math.max(0, Math.min(1, u))
    return c * c * (3 - 2 * c)
}

/** Rises smoothly from 0 to 1 as `t` crosses `at`, over a span of `fadeSpan` ending exactly at `at`. */
function riseTo1(t: number, at: number, fadeSpan: number): number {
    if (t >= at) return 1
    const span = Math.max(1e-6, fadeSpan)
    if (t <= at - span) return 0
    return smoothstep01((t - (at - span)) / span)
}

/**
 * Per-level alpha (coarsest → finest), one entry per level, for the N-level cluster-name ladder at
 * zoom progress `t`. A true partition of unity below `revealT` (the entries always sum to 1 — a
 * crossfade between adjacent levels, never independent fades), landing on `[0,…,0,1]` (only the
 * finest level "current") at/after `revealT`, where `clusterLabelAlpha`/`fileLabelAlpha` own the
 * rest of the fade into file names. Implemented as telescoping "have we entered level i yet"
 * indicators (`entered(0)=1`, `entered(levelCount)=0`, each boundary in between its own smoothstep)
 * so `alpha[i] = entered(i) - entered(i+1)` — the same shape as `fileLabelAlpha`/`clusterLabelAlpha`,
 * generalized to `levelCount - 1` internal boundaries instead of one.
 */
export function clusterLevelAlphas(
    t: number,
    levelCount: number,
    revealT: number = FILE_LABEL_REVEAL_T,
): number[] {
    const n = Math.max(1, levelCount)
    if (t >= revealT)
        return Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0))
    const bounds = levelBoundaries(n, revealT)
    const entered = (i: number): number => {
        if (i <= 0) return 1
        if (i >= n) return 0
        const segStart = bounds[i - 1],
            segEnd = bounds[i]
        const fadeSpan = (segEnd - segStart) * LEVEL_FADE_FRAC
        return riseTo1(t, segEnd, fadeSpan)
    }
    return Array.from({ length: n }, (_, i) => entered(i) - entered(i + 1))
}

/** Hard cap (TOTAL characters) on a cluster label's text — see `clusterLabelText`. Cluster names are
 *  free-form note-title-ish sentences pulled from the vault's community detector, but the field
 *  draws them on a fixed-width monospace GRID at coarse zoom stops: an uncapped label spills across
 *  neighbouring cells and paints over whatever else the aggregate view put there (the "soup" — see
 *  AsciiGraphRenderer's `eyebrowWidthCells` and its occupancy reservation, which assumes a label's
 *  length is bounded by this constant). */
export const CLUSTER_LABEL_MAX_CHARS = 20

/** Eyebrow-register text for a cluster name: upper-cased, matching the design system's
 *  `.asc-eyebrow` treatment (`--ls-eyebrow` tracking is applied by the canvas caller via
 *  `ctx.letterSpacing`, not baked into the string), then hard-capped to `maxChars` TOTAL characters
 *  (default `CLUSTER_LABEL_MAX_CHARS`) by dropping trailing WORDS — never mid-word, and never with an
 *  ASCII ".." or Unicode "…" tail (both read as nonsense on a field of real vault names: ".." looks
 *  like a broken path, and a non-ASCII glyph doesn't share the font's fixed per-cell advance,
 *  shearing the rest of the line off its cells anyway). A single word that alone exceeds `maxChars`
 *  renders WHOLE rather than being chopped into an unreadable fragment (rare — `pickExemplar` in
 *  core/src/community.ts already prefers a hub-pool candidate that fits outright, so this only fires
 *  when nothing in the pool does). */
export function clusterLabelText(
    name: string,
    maxChars: number = CLUSTER_LABEL_MAX_CHARS,
): string {
    const upper = name.toUpperCase()
    if (upper.length <= maxChars) return upper
    const words = upper.split(/\s+/).filter(Boolean)
    let out = ''
    for (const w of words) {
        const next = out ? `${out} ${w}` : w
        if (next.length > maxChars) return out || w // out="" → first word alone exceeds the cap, whole
        out = next
    }
    return out
}

/**
 * Real drawn width, in GRID CELLS, of an eyebrow (cluster) label of `len` characters when the
 * canvas additionally applies `trackingEm` em of `ctx.letterSpacing` tracking at `fontPx` on top of
 * the grid's own `cellW`-px character advance (see AsciiGraphRenderer's `CLUSTER_LABEL_TRACKING_EM`
 * / eyebrow `fillText` call). Canvas letterSpacing pads every glyph — including the last — by that
 * many px, so the drawn run is `len * cellW + len * (trackingEm * fontPx)` px wide, i.e.
 * `len * (1 + trackingEm*fontPx/cellW)` CELLS. Ceil'd so an occupancy reservation never
 * under-covers a partial cell, and floored at `len` (tracking only ever WIDENS a label, never
 * narrows it). A non-finite or non-positive `cellW` (unmeasured canvas, degenerate boot state)
 * falls back to the untracked `len` instead of propagating a NaN/Infinity into the caller's
 * occupancy math — the same non-finite discipline as `graphFit.ts`'s guards.
 */
export function eyebrowWidthCells(
    len: number,
    trackingEm: number,
    fontPx: number,
    cellW: number,
): number {
    if (!Number.isFinite(cellW) || cellW <= 0) return len
    const cells = Math.ceil(len * (1 + (trackingEm * fontPx) / cellW))
    return Math.max(len, cells)
}
