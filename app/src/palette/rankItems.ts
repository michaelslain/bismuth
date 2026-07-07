// app/src/palette/rankItems.ts
// Pure fuzzy-rank + frecency-blend shared by every palette-style surface: the modal
// command/quick surfaces (PaletteModal.tsx) AND the in-window Cmd+O switcher
// (SwitcherBar.tsx). Extracted so the two can't drift apart — one Fuse config, one
// frecency blend, one match shape. No Solid, no DOM: fully unit-testable.
import Fuse from "fuse.js";

export type PaletteItem = {
  id: string;
  label: string;
  sublabel?: string; // muted secondary text (e.g. a folder path)
  description?: string; // optional faint second-line description under the label
  shortcut?: string; // optional right-aligned shortcut-key hint (already display-formatted)
  icon?: string; // optional leading icon (Lucide name or emoji)
};

/** One ranked result: the item plus the matched-char indices in its label. */
export type Match = { item: PaletteItem; indices: number[] };

// Cap rendered rows: fuzzy ranking floats the best matches to the top, so a large
// vault (1000s of files) doesn't render 1000s of DOM rows on open.
export const MAX_RESULTS = 50;

// How much frecency may nudge a fuzzy match, on the same 0..1 scale as text "goodness"
// (1 = perfect match). Small on purpose: a perfect/prefix match (goodness ≈ 1) always beats
// a fuzzy-but-frecent one (goodness + ≤0.15); frecency only reorders similar-quality matches.
const FRECENCY_WEIGHT = 0.15;

// Collapse matched-char indices into contiguous runs so we render a handful of
// segments per label instead of one DOM node per character (the latter explodes
// on large lists). Returns alternating matched / unmatched text runs.
export function toSegments(text: string, indices: number[]): { text: string; match: boolean }[] {
  if (indices.length === 0) return [{ text, match: false }];
  const set = new Set(indices);
  const segs: { text: string; match: boolean }[] = [];
  let run = "";
  let runMatch = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== runMatch) {
      if (run) segs.push({ text: run, match: runMatch });
      run = "";
      runMatch = m;
    }
    run += text[i];
  }
  if (run) segs.push({ text: run, match: runMatch });
  return segs;
}

/**
 * Rank `items` against `query`, optionally blending a frecency score (higher = used
 * more/recently — see frecency.ts). Pure:
 *  - Empty query: with frecency, most-frecent first (stable — equal/zero scores keep the
 *    incoming order); without it, the plain incoming order. Capped to MAX_RESULTS.
 *  - Non-empty query: Fuse fuzzy match, then frecency nudges near-ties (a decisively better
 *    text match is never overtaken). Capped to MAX_RESULTS.
 */
export function rankItems(
  items: PaletteItem[],
  query: string,
  frecency?: (id: string) => number,
): Match[] {
  const q = query.trim();
  if (!q) {
    // Decorate-sort so frecency() is called once per item, not per comparison.
    const ordered = frecency
      ? items
          .map((item) => ({ item, f: frecency(item.id) }))
          .sort((a, b) => b.f - a.f)
          .map((s) => s.item)
      : items;
    return ordered.slice(0, MAX_RESULTS).map((item) => ({ item, indices: [] }));
  }

  const fuse = new Fuse(items, {
    keys: ["label"],
    includeMatches: true,
    includeScore: true, // needed to blend frecency into the text-match rank
    ignoreLocation: true,
    threshold: 0.4,
  });

  const hits = fuse.search(q, { limit: MAX_RESULTS }).map((r) => {
    const labelMatch = r.matches?.find((m) => m.key === "label");
    const indices: number[] = [];
    for (const [start, end] of labelMatch?.indices ?? []) {
      for (let i = start; i <= end; i++) indices.push(i);
    }
    // Fuse score: 0 = perfect, 1 = worst. Convert to "goodness" (higher = better) so it
    // shares a scale with the frecency boost below.
    return { item: r.item, indices, goodness: 1 - (r.score ?? 0) };
  });

  if (!frecency) return hits.map(({ item, indices }) => ({ item, indices }));

  // Blend frecency as a gentle boost: normalize each hit's frecency against the max in
  // THIS candidate set (relative, so absolute counts don't matter), scale by
  // FRECENCY_WEIGHT, add to goodness, and re-sort. Ties/near-ties get reordered by usage;
  // a decisively better text match is never overtaken. Stable sort keeps Fuse's order
  // when boosts are equal (e.g. no history yet).
  let maxF = 0;
  for (const h of hits) maxF = Math.max(maxF, frecency(h.item.id));
  const ranked = hits
    .map((h) => ({
      h,
      rank: h.goodness + (maxF > 0 ? FRECENCY_WEIGHT * (frecency(h.item.id) / maxF) : 0),
    }))
    .sort((a, b) => b.rank - a.rank);
  return ranked.map(({ h }) => ({ item: h.item, indices: h.indices }));
}
