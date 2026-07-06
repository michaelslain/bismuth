import { basename } from "node:path";
import { extractWikilinks } from "./wikilinks";
import { noteId, resolveLinkTarget } from "./vault";
import { buildGraphFromNotes } from "./graphBuilder";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

const MEM = (base: string) => `mem:${base}`;

export interface MemoryGraph extends GraphData {
  /** relative id (no mem: prefix) -> raw wikilink targets, for cross-brain resolution in engine.ts */
  links: Map<string, string[]>;
}

export async function buildMemoryGraph(root: string): Promise<MemoryGraph> {
  const links = new Map<string, string[]>();

  const nodeBuilder = (rel: string): GraphNode => {
    const rid = noteId(rel);
    const base = basename(rid);
    return { id: MEM(rid), label: base, kind: "memory" };
  };

  const edgeExtractor = (
    nodeId: string,
    content: string,
    byBase: Map<string, string>,
    byPath: Map<string, string>,
  ): GraphEdge[] => {
    const edges: GraphEdge[] = [];
    const targets = extractWikilinks(content);

    // Key by the full relative id (format: "mem:<relative-path>") so subfolder
    // notes reconstruct their real node id and same-basename notes stay distinct.
    const rid = nodeId.slice("mem:".length);
    links.set(rid, targets);

    // Create edges to other memory notes. Resolve path-qualified links by full
    // path first, falling back to basename (mirrors resolveNotePath order).
    for (const target of targets) {
      const toId = resolveLinkTarget(target, byBase, byPath);
      if (toId) edges.push({ from: nodeId, to: toId, kind: "link" });
    }

    return edges;
  };

  const { nodes, edges } = await buildGraphFromNotes(root, nodeBuilder, edgeExtractor);

  return { nodes, edges, links };
}
