import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

/**
 * Normalize a relative path to a note id (remove .md extension).
 * Used consistently across vault and memory graph builders.
 */
export function noteId(rel: string): string {
  return rel.replace(/\.md$/i, "");
}

/**
 * Top-level folder of a note's relative path.
 * "reading/quotes/x.md" → "reading"
 * "x.md"                → "(root)"
 */
function topFolder(rel: string): string {
  const slash = rel.indexOf("/");
  return slash === -1 ? "(root)" : rel.slice(0, slash);
}

export async function buildVaultGraph(root: string): Promise<GraphData> {
  const rels = await listMarkdown(root);
  const notes: GraphNode[] = [];
  const byBase = new Map<string, string>();

  // Build note nodes and index by basename
  for (const rel of rels) {
    const id = noteId(rel);
    const label = basename(rel).replace(/\.md$/i, "");
    notes.push({ id, label, kind: "note", folder: topFolder(rel) });
    byBase.set(label, id);
  }

  // Read all contents in parallel
  const contents = new Map<string, string>(
    await Promise.all(rels.map(async (rel) => [noteId(rel), await readNote(root, rel)] as const))
  );

  // Extract edges and tag nodes in a single pass
  const edges: GraphEdge[] = [];
  const tagNodes = new Map<string, GraphNode>();

  for (const note of notes) {
    const raw = contents.get(note.id)!;
    const { data, body } = parseFrontmatter(raw);

    // Wikilink edges: create edges to existing notes only
    for (const target of extractWikilinks(raw)) {
      const toId = byBase.get(target);
      if (toId) edges.push({ from: note.id, to: toId, kind: "link" });
    }

    // Tag edges and nodes: create nodes on first reference
    for (const tag of extractTags(data, body)) {
      const tagId = `tag:${tag}`;
      tagNodes.set(tagId, tagNodes.get(tagId) ?? { id: tagId, label: `#${tag}`, kind: "tag" });
      edges.push({ from: note.id, to: tagId, kind: "tag" });
    }
  }

  return { nodes: [...notes, ...tagNodes.values()], edges };
}
