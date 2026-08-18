// app/src/graph/clusterVisual.ts
//
// Pure cluster-visual intelligence ported out of the deleted Canvas renderer (see
// graphRenderer.ts's EPITAPH for what that renderer was). No renderer state, no canvas context:
// every function here takes and returns plain data so a grid-based renderer can consume it,
// quantising an anchor's exact pixel down to a cell itself. That quantisation is the one accepted
// cost of the character grid: a cluster name lands on a hub's CELL rather than a hub's exact pixel.
//
// This module exists to fix two failures Canvas's own comments record as MEASURED, on the reference
// vault, against the exact approach ASCII still ships today:
//
//   buildColorSlots (CanvasGraphRenderer.ts:748-761), on ASCII's hash-based `colorLevelsFor`/
//   `RAMP[hashKey(key) % 5]`: "Hashing (`paletteColor`) was the original scheme and it does not work
//   for a hierarchy: the palette holds 5-6 colours, the coarsest level of a real vault has ~9-11
//   substantial groups, and independent hashes collide freely — on the reference vault nearly every
//   big top-level group landed on the same teal, so the field read as one colour and the grouping
//   was invisible."
//
//   drawClusterNames (CanvasGraphRenderer.ts:1559-1562), on ASCII's centroid-anchored
//   `layoutClusterNames`: "A vault's communities are hub-and-spoke and sprawling, so the centroid of
//   a 400-node community routinely lands in empty space — the names then read as free-floating text
//   captioning nothing."
//
// Ported: `buildColorSlots` (:762-794), the hub-anchoring + size-ramp logic from the cluster-name
// pass (:307-316, 1566-1648), `trimDanglingWord`, and `inViewport` (:932-936). The *algorithm* is
// preserved, not Canvas's renderer-coupled representation: colours are CSS colour strings (a theme's
// resolved `--graph-0..4` tokens) instead of packed ints, and positions/degrees are plain `{sx,sy}`/
// `{id,degree}` records instead of live `NodeView`s.

// ---------------------------------------------------------------------------
// Colour string <-> HSL — a string-in/string-out mirror of CanvasGraphRenderer.ts's
// rgbToHsl/hslToRgb (:337-362), which operate on a packed 0xRRGGBB int. Kept internal: callers only
// ever see hex strings in and out of `buildColorSlots`.
// ---------------------------------------------------------------------------

/** Parse `#rgb`/`#rrggbb` hex or `rgb()`/`rgba()` into 0..255 channels. Mirrors
 *  AsciiGraphRenderer.ts's `parseColorToRGB` — the format the theme tokens table (theme/tokens.ts)
 *  actually produces — so this module accepts exactly what `readTokens()` already resolves. */
function parseCssColorToRgb(css: string): [number, number, number] | null {
    const s = css.trim()
    if (s[0] === '#') {
        const h = s.slice(1)
        if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16),
                g = parseInt(h[1] + h[1], 16),
                b = parseInt(h[2] + h[2], 16)
            return Number.isFinite(r) &&
                Number.isFinite(g) &&
                Number.isFinite(b)
                ? [r, g, b]
                : null
        }
        if (h.length >= 6) {
            const r = parseInt(h.slice(0, 2), 16),
                g = parseInt(h.slice(2, 4), 16),
                b = parseInt(h.slice(4, 6), 16)
            return Number.isFinite(r) &&
                Number.isFinite(g) &&
                Number.isFinite(b)
                ? [r, g, b]
                : null
        }
        return null
    }
    const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
    return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null
}

/** Ported verbatim from `rgbToHsl` (CanvasGraphRenderer.ts:337-348), channels pre-split instead of
 *  packed into one int. */
function rgbToHsl(
    r255: number,
    g255: number,
    b255: number,
): [number, number, number] {
    const r = r255 / 255,
        g = g255 / 255,
        b = b255 / 255
    const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        l = (mx + mn) / 2
    if (mx === mn) return [0, 0, l]
    const d = mx - mn
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    let h = 0
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return [h / 6, sat, l]
}

function parseCssColorToHsl(css: string): [number, number, number] | null {
    const rgb = parseCssColorToRgb(css)
    return rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null
}

/** Ported verbatim from `hslToRgb` (CanvasGraphRenderer.ts:349-362), returning a hex string instead
 *  of a packed int. */
function hslToHex(h: number, sat: number, l: number): string {
    h = ((h % 1) + 1) % 1
    const toHex = (v: number) => v.toString(16).padStart(2, '0')
    if (sat === 0) {
        const v = Math.round(l * 255) & 0xff
        return `#${toHex(v)}${toHex(v)}${toHex(v)}`
    }
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat,
        p = 2 * l - q
    const ch = (t: number) => {
        t = ((t % 1) + 1) % 1
        const v =
            t < 1 / 6
                ? p + (q - p) * 6 * t
                : t < 1 / 2
                  ? q
                  : t < 2 / 3
                    ? p + (q - p) * (2 / 3 - t) * 6
                    : p
        return Math.round(v * 255) & 0xff
    }
    return `#${toHex(ch(h + 1 / 3))}${toHex(ch(h))}${toHex(ch(h - 1 / 3))}`
}

const FALLBACK_HEX = '#888888'

/**
 * The hierarchy path used for both colour and edge levels, with the pre-hierarchy fallbacks —
 * ported verbatim from `pathOf` (CanvasGraphRenderer.ts:320-323). Exported because it is the most
 * error-prone few lines in any caller that builds this module's inputs (`communitySizes` for
 * `buildColorSlots`, `members` for `pickHubAnchor`/`clusterExtent`): forgetting the `null` case
 * buckets nodes with no community under a key of `undefined`; forgetting to clamp a level index
 * against `path.length` (a caller's job — the level clamp is `path[Math.min(L, path.length - 1)]`,
 * not part of this function) silently drops every node whose path is shallower than the level being
 * built, shrinking coarse communities. Returns `null` for a node with no community at all (self,
 * daemon, cron, process, or a graph mode that never stamps one) — callers must skip those, not
 * bucket them under `null`/`undefined`.
 */
export function pathOf(node: {
    communityPath?: number[] | null
    community?: number | null
}): number[] | null {
    if (node.communityPath?.length) return node.communityPath
    return node.community != null ? [node.community] : null
}

// ---------------------------------------------------------------------------
// Size-ranked cluster colours — ported from `buildColorSlots` (CanvasGraphRenderer.ts:762-794).
// ---------------------------------------------------------------------------

/** Node-fill saturation boost (`NODE_SAT_BOOST`, CanvasGraphRenderer.ts:128): thousands of 2-4px
 *  dots need to survive being a speck on screen, so every slot is pushed toward the saturated end of
 *  the theme's own hue rather than left at the ~35% saturation that reads fine as UI chrome. Exported
 *  (along with `LIGHTNESS_CLAMP` below) so tests can pin the literal value directly — a pure-primary
 *  input (sat already 1.0) clamps under any boost ≥ `SAT_CLAMP`, so the boost's actual magnitude is
 *  only observable against a muted/pastel input; see clusterVisual.test.ts. */
export const NODE_SAT_BOOST = 1.55
const SAT_CLAMP = 0.85
const LIGHTNESS_MULT = 1.06
export const LIGHTNESS_CLAMP = 0.72
/** Each wrap around the palette rotates hue by half a palette step rather than lightening it.
 *  Canvas's comment on why: lightening "is what washed the whole field out to near-white — the
 *  theme's ramp is already pastel, so blending it toward white produced pale smears with no colour
 *  identity at all" (CanvasGraphRenderer.ts:780-783). */
const HUE_ROTATE_PER_CYCLE = 0.5

/**
 * Rank communities by member count — ties broken by community id, ascending, so the ranking is
 * stable across rebuilds — and assign palette slots BY RANK, not by hashing the community id. See
 * the module header for the measured failure of hashing this replaces. Ported from `buildColorSlots`
 * (CanvasGraphRenderer.ts:762-794).
 *
 * Communities past the palette's length wrap around; each wrap gets a hue-rotated variant of its
 * slot so repeat cycles stay visually distinct from the first instead of becoming exact duplicates.
 *
 * `palette` is an ordered list of CSS colour strings (`#rgb`/`#rrggbb`/`rgb()`/`rgba()`) — the
 * ASCII side passes its resolved `--graph-0..4` theme tokens directly; no int palette required. An
 * unparseable or missing palette entry falls back to a neutral grey rather than throwing.
 */
export function buildColorSlots(
    communitySizes: ReadonlyMap<number, number>,
    palette: readonly string[],
): Map<number, string> {
    const palLen = Math.max(1, palette.length)
    const fallbackHsl = parseCssColorToHsl(FALLBACK_HEX)!
    const ranked = [...communitySizes.entries()].sort(
        (a, b) => b[1] - a[1] || a[0] - b[0],
    )
    const slots = new Map<number, string>()
    ranked.forEach(([community], rank) => {
        const base = palette[rank % palLen]
        const hsl = (base ? parseCssColorToHsl(base) : null) ?? fallbackHsl
        const cycle = Math.floor(rank / palLen)
        const hue = hsl[0] + (cycle * HUE_ROTATE_PER_CYCLE) / palLen
        const sat = Math.min(SAT_CLAMP, hsl[1] * NODE_SAT_BOOST)
        const l = Math.min(LIGHTNESS_CLAMP, hsl[2] * LIGHTNESS_MULT)
        slots.set(community, hslToHex(hue, sat, l))
    })
    return slots
}

// ---------------------------------------------------------------------------
// Hub-anchored cluster names — ported from the hub pass of `buildLevelEdges`
// (CanvasGraphRenderer.ts:865-874) and the anchoring + size-ramp logic of `drawClusterNames`
// (:1554-1631).
// ---------------------------------------------------------------------------

/**
 * The anchor of a community: its highest-degree member, ties broken by lowest id — NOT the same
 * rule the backend uses to pick a community's exemplar (`pickExemplar`, core/src/community.ts,
 * degree DESC then label LENGTH then id, over a degree-fraction pool, preferring tag-kind members —
 * a much richer rule aimed at a SHORT readable label, not a stable anchor point). This function only
 * needs the latter: a total order that never flickers between two equal-degree members frame to
 * frame, which "highest degree, ties by lowest id" already guarantees on its own — it does not need
 * to reproduce the exemplar rule to do that job. Ported from the hub pass of `buildLevelEdges`
 * (CanvasGraphRenderer.ts:865-874: "Hubs first — the anchors both the lines and the names use.").
 *
 * Generic over `id`'s type: the ported source compares `nv.node.id < cur.node.id`, i.e. a STRING
 * (`GraphNode.id`) — callers with numeric ids (e.g. a synthetic index) work identically, since `<`
 * total-orders both. Passing a caller-invented numeric surrogate (array index, insertion order, …)
 * instead of the real id changes WHICH member a tie resolves to versus the ported source, even
 * though both are equally "stable" in the sense of never flickering frame to frame — prefer the
 * real id when one is available.
 *
 * `drawClusterNames`'s doc comment (:1559-1562) is the rationale for hub over centroid: "A vault's
 * communities are hub-and-spoke and sprawling, so the centroid of a 400-node community routinely
 * lands in empty space — the names then read as free-floating text captioning nothing. The hub is
 * both where the mass visibly converges AND the node the exemplar name was taken from."
 *
 * Returns only the member id, never a position — the grid quantises a hub's CELL,
 * not its exact pixel, so the caller looks the id back up (to get its screen position, then its
 * cell) rather than receiving a pixel from here.
 *
 * **Call-site contract — both halves matter, and both are load-bearing, not incidental:**
 *
 * 1. `members` must be the community's WHOLE membership (every node in that community, anywhere in
 *    the graph), not just what's currently on screen. Source (`buildLevelEdges`, :1584-1586, at the
 *    call site inside `drawClusterNames`): "The hub comes from the PRECOMPUTED per-level table, NOT
 *    from a running max over the visible members — so a group's name and the group-level lines
 *    meeting at it share one anchor, and the anchor doesn't jump as members pan in and out of
 *    frame." Call this once per structural rebuild (statically, like the source does — hubs don't
 *    move unless communities do) and reuse the same result every frame, the same way `clusterExtent`
 *    below reuses the SAME hub it returns.
 * 2. `degree` must be WHOLE-GRAPH undirected degree (`GraphNode.deg` in the source, documented there
 *    as "undirected degree (drives node size)" — CanvasGraphRenderer.ts:211) — not degree restricted
 *    to edges within the community, and not degree restricted to the visible field.
 *
 * This is the OPPOSITE member-set requirement from `clusterExtent` below, which must be fed only the
 * viewport-visible members of the SAME community (it measures how far a label has to reach across
 * what the user can actually see this frame). Building one `visibleMembers` array and passing it to
 * both is the specific bug this split contract exists to prevent: the anchor would then recompute
 * every frame from whatever happens to be on screen and visibly jump as the user pans — invisible to
 * any test in this module, since nothing here owns "the same frame" or "the previous frame".
 */
export function pickHubAnchor<T extends string | number>(
    members: Iterable<{ id: T; degree: number }>,
): T | undefined {
    let best: { id: T; degree: number } | undefined
    for (const m of members) {
        if (
            !best ||
            m.degree > best.degree ||
            (m.degree === best.degree && m.id < best.id)
        )
            best = m
    }
    return best?.id
}

/** Below this many members — or this share of what's actually VISIBLE this frame, whichever is
 *  larger (see `clusterLabelThreshold`) — a community doesn't get a name at all: the long tail of
 *  scraps. Ported from `CLUSTER_LABEL_MIN_MEMBERS`/`CLUSTER_LABEL_MIN_SHARE`
 *  (CanvasGraphRenderer.ts:151-152). */
export const CLUSTER_LABEL_MIN_MEMBERS = 6
export const CLUSTER_LABEL_MIN_SHARE = 0.015

/**
 * The minimum member count a community needs to earn a name, given how many nodes are actually
 * visible this frame (not the whole graph). Ported from the threshold in `drawClusterNames`
 * (CanvasGraphRenderer.ts:1605-1610): "as the camera closes on a region, the communities inside it
 * grow as a share of the visible field, so smaller ones cross the bar and name themselves — instead
 * of the same handful of global masses being the only things ever labelled."
 */
export function clusterLabelThreshold(visibleTotal: number): number {
    return Math.max(
        CLUSTER_LABEL_MIN_MEMBERS,
        Math.round(visibleTotal * CLUSTER_LABEL_MIN_SHARE),
    )
}

/** The size-ramp's steepness — ported from the literal `2.2` in `drawClusterNames`
 *  (CanvasGraphRenderer.ts:1619). */
const CLUSTER_LABEL_RAMP_STEEPNESS = 2.2

/**
 * A community's [0,1] name-size progress, by its share of the VISIBLE field — same "alive at every
 * zoom" reasoning as `clusterLabelThreshold`. sqrt-eased (so a 4x member-count difference reads as a
 * 2x size difference, not 4x) and capped at 1. Ported from the `px` formula in `drawClusterNames`
 * (CanvasGraphRenderer.ts:1619): `CLUSTER_LABEL_MIN_PX + (MAX_PX - MIN_PX) * thisValue` is how Canvas
 * maps it to a font-size range; a grid renderer maps this same [0,1] into its own size/weight/
 * emphasis unit instead of literal px.
 */
export function clusterLabelScale(
    memberCount: number,
    visibleTotal: number,
): number {
    if (visibleTotal <= 0) return 0
    return Math.min(
        1,
        Math.sqrt(memberCount / visibleTotal) * CLUSTER_LABEL_RAMP_STEEPNESS,
    )
}

/** How far a cluster name lifts above its hub, in screen px: a constant minimum plus the group's own
 *  on-screen extent (capped), so a big mass's name clears the whole mass instead of a fixed offset.
 *  Ported from `CLUSTER_LABEL_LIFT_PX`/`CLUSTER_LABEL_MAX_LIFT_PX` (CanvasGraphRenderer.ts:132,135)
 *  and the lift arithmetic in `drawClusterNames` (CanvasGraphRenderer.ts:1618). */
export const CLUSTER_LABEL_LIFT_PX = 10
export const CLUSTER_LABEL_MAX_LIFT_PX = 46

export function clusterLabelLift(extent: number): number {
    return CLUSTER_LABEL_LIFT_PX + Math.min(CLUSTER_LABEL_MAX_LIFT_PX, extent)
}

/**
 * A community's on-screen extent around its hub anchor: the max, over its members, of
 * `max(|dy|, |dx| * 0.5)` — vertical distance dominates because the name lifts UPWARD off the hub,
 * so width matters half as much as height for how far it has to clear. Ported from
 * `drawClusterNames`'s per-member accumulation (CanvasGraphRenderer.ts:1596-1600).
 *
 * `members` here must be VIEWPORT-VISIBLE members only (filter with `inViewport` below first),
 * matching the source — this is the extent of what the user can actually see this frame, not the
 * whole community. `hub`, by contrast, should be the SAME anchor `pickHubAnchor` returned (whole-
 * graph, precomputed, unaffected by panning) — see the deliberately opposite member-set contract
 * documented on `pickHubAnchor` above. Do not build one member list and feed it to both.
 */
export function clusterExtent(
    hub: { sx: number; sy: number },
    members: Iterable<{ sx: number; sy: number }>,
): number {
    let rad = 0
    for (const m of members) {
        const dy = Math.abs(m.sy - hub.sy)
        const dx = Math.abs(m.sx - hub.sx)
        const r = Math.max(dy, dx * 0.5)
        if (r > rad) rad = r
    }
    return rad
}

// ---------------------------------------------------------------------------
// trimDanglingWord — ported verbatim from CanvasGraphRenderer.ts:307-317.
// ---------------------------------------------------------------------------

/** Words a cluster name must not END on. Exemplar names are real note titles clipped to fit
 *  (`clusterLabelText` in labelSelection.ts), so the clip regularly leaves a dangling conjunction or
 *  preposition — "LUDWIG FEUERBACH AND" reads as a sentence cut off mid-thought rather than as a
 *  region's name. Uppercase because the trim runs AFTER a label has already been cased + clipped.
 *  Ported verbatim from `DANGLING_WORDS` (CanvasGraphRenderer.ts:308-310). */
const DANGLING_WORDS = new Set([
    'AND',
    'OR',
    'OF',
    'THE',
    'A',
    'AN',
    'IN',
    'ON',
    'AT',
    'TO',
    'FOR',
    'WITH',
    'FROM',
    'BY',
    'AS',
    'IS',
    'VS',
])

/**
 * Drop trailing dangling words, repeatedly ("THE LOSS IN THE" loses both "IN" and the second "THE").
 * Never returns empty: a name made only of such words keeps its first word. Ported verbatim from
 * `trimDanglingWord` (CanvasGraphRenderer.ts:313-317).
 *
 * Note: the brief that commissioned this module suggested a `(text, maxWidth, measure)` signature.
 * The actual source function takes neither parameter — it only ever drops trailing stopwords, and
 * the character-count clip that must run BEFORE it already lives in `clusterLabelText`
 * (labelSelection.ts). Ported the real signature per this plan's own instruction to trust the
 * source over plan-authored specifics (the merge plan's own rule: "plan-authored code has been
 * wrong repeatedly").
 */
export function trimDanglingWord(text: string): string {
    const words = text.split(/\s+/).filter(Boolean)
    while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1]))
        words.pop()
    return words.join(' ')
}

// ---------------------------------------------------------------------------
// inViewport — ported from CanvasGraphRenderer.ts:927-936.
// ---------------------------------------------------------------------------

/**
 * Is a screen point inside the actual viewport, padded by `pad` px — not merely in front of the
 * camera? Ported from `inViewport` (CanvasGraphRenderer.ts:927-936): "Every label decision has to
 * use this instead [of mere depth-culling]: otherwise the file-label budget is spent ranking global
 * hubs that are off-frame, which is why zooming in used to surface no new names, and a cluster's
 * member count / anchor would describe nodes the user can't see."
 *
 * The source also gates on `nv.onScreen` (a renderer's own depth-culling flag, e.g. behind-camera in
 * 3D) before this check. That is renderer/projection state, out of scope for this pure module —
 * callers should AND their own on-screen flag into the result.
 */
export function inViewport(
    sx: number,
    sy: number,
    w: number,
    h: number,
    pad: number,
): boolean {
    return sx >= -pad && sx <= w + pad && sy >= -pad && sy <= h + pad
}
