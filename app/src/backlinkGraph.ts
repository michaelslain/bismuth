// app/src/backlinks.ts
// Pure derivation of a note's backlinks from an already-fetched /graph payload (no backend
// change — see FileView.tsx + Backlinks.tsx). Kept dependency-free (types only from core/src/graph)
// so it's trivially unit-testable, matching the pattern of graph/labelSelection.ts.
import type { GraphData } from "../../core/src/graph";

export interface BacklinkEntry {
  /** The linking note's graph node id (its vault path minus the .md extension). */
  id: string;
  /** Display label (the note's basename, as carried on the graph node). */
  label: string;
}

/**
 * Normalize a vault-relative note path to its graph node id (strip a trailing `.md`,
 * case-insensitively) — mirrors `noteId()` in core/src/vault.ts. Duplicated here (rather than
 * importing the backend module) so this stays a pure, dependency-free frontend helper.
 */
export function pathToNoteId(path: string): string {
  return path.replace(/\.md$/i, "");
}

/**
 * Notes that link to `noteId` — vault edges of kind "link" (or "tag", included for forward
 * compatibility with any future note-to-note tag edge) whose `to` is this note. Self-links are
 * dropped, results are deduped by source id and sorted by label. Only "note" kind sources are
 * openable in the editor, so anything else (e.g. a stray non-note `to` match) is excluded.
 */
export function deriveBacklinks(graph: GraphData, noteId: string): BacklinkEntry[] {
  if (!noteId) return [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const seen = new Map<string, BacklinkEntry>();
  for (const edge of graph.edges) {
    if (edge.to !== noteId) continue;
    if (edge.kind !== "link" && edge.kind !== "tag") continue;
    if (edge.from === noteId) continue; // no self-backlinks
    if (seen.has(edge.from)) continue;
    const node = nodesById.get(edge.from);
    if (!node || node.kind !== "note") continue;
    seen.set(edge.from, { id: node.id, label: node.label });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
