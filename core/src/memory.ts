import { basename } from "node:path";
import { listMarkdown, readNote } from "./files";
import { extractWikilinks } from "./wikilinks";
import { noteId, resolveLinkTarget } from "./vault";
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
  const byPath = new Map<string, string>();
  const links = new Map<string, string[]>();

  // Build memory nodes and index by basename + full path
  for (const rel of rels) {
    const rid = noteId(rel);
    const base = basename(rid);
    const id = MEM(base);
    nodes.push({ id, label: base, kind: "memory" });
    byBase.set(base, id);
    byPath.set(rid, id);
  }

  // Read all contents and extract links in parallel
  const edges: GraphEdge[] = [];
  await Promise.all(
    rels.map(async (rel) => {
      const base = basename(noteId(rel));
      const content = await readNote(root, rel);
      const targets = extractWikilinks(content);
      links.set(base, targets);
      // Create edges to other memory notes. Resolve path-qualified links by full
      // path first, falling back to basename (mirrors resolveNotePath order).
      for (const t of targets) {
        const toId = resolveLinkTarget(t, byBase, byPath);
        if (toId) edges.push({ from: MEM(base), to: toId, kind: "link" });
      }
    }),
  );

  return { nodes, edges, links };
}
