/**
 * Self-contained, deterministic community detection via synchronous label propagation.
 *
 * No external dependencies, no RNG. Processing is fully deterministic:
 *   - Nodes are processed in sorted (lexicographic) id order.
 *   - Each node adopts the most common community among its neighbors.
 *   - Ties are broken by the smallest community id.
 *   - A fixed iteration cap of 20 bounds the work.
 *
 * After raw communities settle, communities are post-processed: each community's exemplar is its
 * highest-degree member (tie → lexicographically smallest id), and every member's `label` is set to
 * the exemplar's label. Communities are renumbered to a dense `0..k-1` in order of first appearance.
 * Isolated nodes (no edges) each form their own singleton community labeled by their own label.
 */

export interface CommunityAssignment {
  community: number;
  label: string;
}

const MAX_ITERATIONS = 20;

/** Detect communities on the `link`/`about`/`tag` edge structure. Deterministic across runs.
 *  Each node maps to a numeric community id and an exemplar label (highest-degree member's label;
 *  ties → lexicographically smallest id). Isolated nodes get their own singleton community. Empty
 *  input → empty map. */
export function detectCommunities(
  nodes: { id: string; label: string }[],
  edges: { from: string; to: string }[],
): Map<string, CommunityAssignment> {
  const result = new Map<string, CommunityAssignment>();
  if (nodes.length === 0) return result;

  const labelById = new Map<string, string>();
  for (const n of nodes) labelById.set(n.id, n.label);

  // Build an undirected adjacency set per node (ignore self-loops and edges to unknown nodes).
  const neighbors = new Map<string, Set<string>>();
  for (const n of nodes) neighbors.set(n.id, new Set<string>());
  for (const e of edges) {
    if (e.from === e.to) continue;
    const a = neighbors.get(e.from);
    const b = neighbors.get(e.to);
    if (!a || !b) continue; // endpoint not in node set
    a.add(e.to);
    b.add(e.from);
  }

  // Process nodes in a stable sorted order for determinism.
  const sortedIds = nodes.map((n) => n.id).sort();

  // Map each node id to an integer index used as the initial (and evolving) community id.
  const indexOf = new Map<string, number>();
  sortedIds.forEach((id, i) => indexOf.set(id, i));

  // Initial community: each node in its own community (its sorted index).
  const community = new Map<string, number>();
  for (const id of sortedIds) community.set(id, indexOf.get(id)!);

  // Synchronous-ish label propagation: iterate to a fixed cap, processing ids in sorted order.
  // Each node adopts the most common community among its neighbors; ties → smallest community id.
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    for (const id of sortedIds) {
      const nbrs = neighbors.get(id)!;
      if (nbrs.size === 0) continue; // isolated: keep its own community

      // Tally neighbor communities.
      const counts = new Map<number, number>();
      for (const nb of nbrs) {
        const c = community.get(nb)!;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }

      // Pick the most common community; tie → smallest community id.
      let best = community.get(id)!;
      let bestCount = -1;
      for (const [c, count] of counts) {
        if (count > bestCount || (count === bestCount && c < best)) {
          best = c;
          bestCount = count;
        }
      }

      if (best !== community.get(id)) {
        community.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Post-process: compute undirected degree per node, then per community pick the exemplar
  // (max-degree member; tie → lexicographically smallest id) and adopt its label.
  const exemplarByCommunity = new Map<number, string>();
  for (const id of sortedIds) {
    const c = community.get(id)!;
    const deg = neighbors.get(id)!.size;
    const current = exemplarByCommunity.get(c);
    if (current === undefined) {
      exemplarByCommunity.set(c, id);
      continue;
    }
    const curDeg = neighbors.get(current)!.size;
    // Higher degree wins. Ties resolve to the lexicographically smallest id for free: ids are
    // visited in ascending order, so the first-seen id at a given degree is already the smallest
    // and a later equal-degree id never displaces it.
    if (deg > curDeg) {
      exemplarByCommunity.set(c, id);
    }
  }

  // Renumber communities to dense 0..k-1 in order of first appearance (stable, sorted-id order).
  const denseId = new Map<number, number>();
  let next = 0;
  for (const id of sortedIds) {
    const c = community.get(id)!;
    if (!denseId.has(c)) denseId.set(c, next++);
  }

  for (const id of sortedIds) {
    const rawC = community.get(id)!;
    const exemplar = exemplarByCommunity.get(rawC)!;
    result.set(id, {
      community: denseId.get(rawC)!,
      label: labelById.get(exemplar)!,
    });
  }

  return result;
}
