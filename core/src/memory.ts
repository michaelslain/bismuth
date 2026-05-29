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
  const byBase = new Map<string, string>();

  // Build memory nodes and index by basename
  for (const rel of rels) {
    const base = basename(noteId(rel));
    nodes.push({ id: MEM(base), label: base, kind: "memory" });
    byBase.set(base, MEM(base));
  }

  // Read all contents in parallel
  const contents = new Map<string, string>(
    await Promise.all(rels.map(async (rel) => [basename(noteId(rel)), await readNote(root, rel)] as const))
  );

  // Extract links and create edges in a single pass
  const edges: GraphEdge[] = [];
  const links = new Map<string, string[]>();

  for (const [base, content] of contents) {
    const targets = extractWikilinks(content);
    links.set(base, targets);
    for (const t of targets) {
      const toId = byBase.get(t);
      if (toId) edges.push({ from: MEM(base), to: toId, kind: "link" });
    }
  }

  return { nodes, edges, links };
}
