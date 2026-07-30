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
 * Notes that link to `noteId` — vault "link" edges (a `[[wikilink]]`) whose `to` is this note.
 * Self-links are dropped, results are deduped by source id and sorted by label. Only "note" kind
 * sources are openable in the editor, so anything else is excluded.
 *
 * "tag" edges used to be accepted here too, "for forward compatibility with any future note-to-note
 * tag edge". They were dead weight: a vault tag edge runs note -> TAG NODE, so its `to` is a tag id
 * and can never equal a note id, and even if one did the `kind === "note"` source filter below would
 * drop it. Backlinks are wikilinks — nothing else.
 */
export function deriveBacklinks(graph: GraphData, noteId: string): BacklinkEntry[] {
  if (!noteId) return [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const seen = new Map<string, BacklinkEntry>();
  for (const edge of graph.edges) {
    if (edge.to !== noteId) continue;
    if (edge.kind !== "link") continue;
    if (edge.from === noteId) continue; // no self-backlinks
    if (seen.has(edge.from)) continue;
    const node = nodesById.get(edge.from);
    if (!node || node.kind !== "note") continue;
    seen.set(edge.from, { id: node.id, label: node.label });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}
