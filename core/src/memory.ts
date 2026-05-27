import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { extractWikilinks } from "./wikilinks";
import { noteId } from "./vault";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

const MEM = (base: string) => `mem:${base}`;

export interface MemoryGraph extends GraphData {
  /** basename -> raw wikilink targets, for cross-brain resolution in engine.ts */
  links: Map<string, string[]>;
}

export async function buildMemoryGraph(root: string): Promise<MemoryGraph> {
  const rels = await listMarkdown(root);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byBase = new Map<string, string>();
  const links = new Map<string, string[]>();
  for (const rel of rels) {
    const base = basename(noteId(rel));
    nodes.push({ id: MEM(base), label: base, kind: "memory" });
    byBase.set(base, MEM(base));
    const content = await readNote(root, rel);
    const targets = extractWikilinks(content);
    links.set(base, targets);
  }
  for (const [base, targets] of links) {
    for (const t of targets) {
      const toId = byBase.get(t);
      if (toId) edges.push({ from: MEM(base), to: toId, kind: "link" });
    }
  }
  return { nodes, edges, links };
}
