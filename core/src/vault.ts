import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import { buildGraphFromNotes } from "./graphBuilder";
import type { GraphData, GraphNode, GraphEdge } from "./graph";

/**
 * Decompose a vault-relative path into its components.
 * "reading/quotes/x.md" → { name: "x", ext: "md", folder: "reading/quotes", basename: "x", topFolder: "reading" }
 * "x.md"                → { name: "x", ext: "md", folder: "", basename: "x", topFolder: "(root)" }
 */
export function pathParts(rel: string): { name: string; ext: string; folder: string; basename: string; topFolder: string } {
  const lastSlash = rel.lastIndexOf("/");
  const folder = lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
  const filename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
  const lastDot = filename.lastIndexOf(".");
  const name = lastDot >= 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot >= 0 ? filename.slice(lastDot + 1) : "";
  const topFolder = folder ? folder.slice(0, folder.indexOf("/") === -1 ? folder.length : folder.indexOf("/")) : "(root)";
  return { name, ext, folder, basename: name, topFolder };
}

/**
 * Normalize a relative path to a note id (remove .md extension).
 * Used consistently across vault and memory graph builders.
 */
export function noteId(rel: string): string {
  return rel.replace(/\.md$/i, "");
}

export interface VaultGraphResult {
  graph: GraphData;
  /** basename (without .md extension) → note id, built during graph construction. */
  byBase: Map<string, string>;
  /** full relative path (without .md extension) → note id, for path-qualified wikilinks. */
  byPath: Map<string, string>;
}

/**
 * Resolve a wikilink target to a note id, mirroring the editor's resolveNotePath order:
 * an exact path match (e.g. `[[reading/My Note]]`) wins, otherwise fall back to basename
 * (e.g. `[[My Note]]`). Returns undefined when nothing matches.
 */
export function resolveLinkTarget(
  target: string,
  byBase: Map<string, string>,
  byPath: Map<string, string>,
): string | undefined {
  return byPath.get(target) ?? byBase.get(target);
}

export async function buildVaultGraph(root: string): Promise<VaultGraphResult> {
  const tagNodes = new Map<string, GraphNode>();

  const nodeBuilder = (rel: string): GraphNode => {
    const id = noteId(rel);
    const parts = pathParts(rel);
    return { id, label: parts.name, kind: "note", folder: parts.topFolder };
  };

  const edgeExtractor = (
    nodeId: string,
    content: string,
    byBase: Map<string, string>,
    byPath: Map<string, string>,
  ): GraphEdge[] => {
    const edges: GraphEdge[] = [];
    const { data, body } = parseFrontmatter(content);

    // Wikilink edges: create edges to existing notes only. Resolve path-qualified
    // links ([[folder/Note]]) by full path, falling back to basename ([[Note]]).
    for (const target of extractWikilinks(content)) {
      const toId = resolveLinkTarget(target, byBase, byPath);
      if (toId) edges.push({ from: nodeId, to: toId, kind: "link" });
    }

    // Tag edges and nodes: create nodes on first reference
    for (const tag of extractTags(data, body)) {
      const tagId = `tag:${tag}`;
      tagNodes.set(tagId, tagNodes.get(tagId) ?? { id: tagId, label: `#${tag}`, kind: "tag" });
      edges.push({ from: nodeId, to: tagId, kind: "tag" });
    }

    return edges;
  };

  const { nodes, edges, byBase, byPath } = await buildGraphFromNotes(root, nodeBuilder, edgeExtractor);

  return { graph: { nodes: [...nodes, ...tagNodes.values()], edges }, byBase, byPath };
}
