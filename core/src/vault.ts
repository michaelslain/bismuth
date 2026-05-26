import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { extractWikilinks } from "./wikilinks";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

/** id = relative path without ".md" */
export function noteId(rel: string): string {
  return rel.replace(/\.md$/i, "");
}

export async function buildVaultGraph(root: string): Promise<GraphData> {
  const rels = await listMarkdown(root);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byBase = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const rel of rels) {
    const id = noteId(rel);
    const label = basename(rel).replace(/\.md$/i, "");
    nodes.push({ id, label, kind: "note" });
    byBase.set(label, id);
    contents.set(id, await readNote(root, rel));
  }
  for (const node of nodes) {
    for (const target of extractWikilinks(contents.get(node.id)!)) {
      const toId = byBase.get(target);
      if (toId) edges.push({ from: node.id, to: toId, kind: "link" });
    }
  }
  return { nodes, edges };
}
