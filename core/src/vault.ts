import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

/** id = relative path without ".md" */
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
  const edges: GraphEdge[] = [];
  const byBase = new Map<string, string>();

  // --- Pass 1: build note nodes and read all contents in parallel ---
  for (const rel of rels) {
    const id = noteId(rel);
    const label = basename(rel).replace(/\.md$/i, "");
    const folder = topFolder(rel);
    notes.push({ id, label, kind: "note", folder });
    byBase.set(label, id);
  }

  const contents = new Map<string, string>(
    await Promise.all(rels.map(async (rel) => [noteId(rel), await readNote(root, rel)] as const))
  );

  // --- Pass 2: link edges + tag collection ---
  const tagNodes = new Map<string, GraphNode>(); // tag id → node

  for (const note of notes) {
    const raw = contents.get(note.id)!;
    const { data, body } = parseFrontmatter(raw);

    // Wikilink edges (against full raw content, unchanged behavior)
    for (const target of extractWikilinks(raw)) {
      const toId = byBase.get(target);
      if (toId) edges.push({ from: note.id, to: toId, kind: "link" });
    }

    // Tag edges
    for (const tag of extractTags(data, body)) {
      const tagId = `tag:${tag}`;
      if (!tagNodes.has(tagId)) {
        tagNodes.set(tagId, { id: tagId, label: `#${tag}`, kind: "tag" });
      }
      edges.push({ from: note.id, to: tagId, kind: "tag" });
    }
  }

  return { nodes: [...notes, ...tagNodes.values()], edges };
}
