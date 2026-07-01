// app/src/graph/youNode.ts
// Injects the "you" hub into a brain graph and links it to the user's open working set.
//
// The self node is a FRONTEND concern: it's keyed off which notes are open as tabs/panes (pure
// client state the backend can't see), so it's layered onto the fetched graph here rather than
// emitted by the graph builders. One self node per brain VIEW (2nd / 3rd / both). Pure module
// (no Solid, no Three.js) so it's unit-testable in isolation.

import type { GraphData, GraphEdge, GraphNode } from "../../../core/src/graph";
import { SELF_NODE_ID } from "../../../core/src/graph";

/**
 * Reduce a tab/pane content id to the graph node id it would correspond to. Note nodes are keyed
 * by their vault path WITHOUT the ".md" extension (see vault.ts); sentinel panes (`::settings`,
 * `::graph`, terminals, etc.) and the self node itself aren't graph nodes, so they're dropped.
 */
function contentToNodeId(content: string): string | null {
  if (content.startsWith("::")) return null;
  return content.replace(/\.md$/, "");
}

/**
 * Return a new graph with the "you" hub prepended and an "open" edge from it to every open
 * tab/pane note that exists in this view's node set. Duplicates and not-yet-loaded / out-of-view
 * notes are skipped, so the hub only links to what's actually on screen.
 *
 * The hub is seeded at the layout origin `[0,0,0]` / `[0,0]` — the center of the cloud. The
 * Canvas-2D renderer (CanvasGraphRenderer) pins it there (it scales the layout about the
 * self-excluded content centroid and maps self to the origin); it runs NO force sim. The clear zone
 * around "you" is opened per-frame in SCREEN space by its `clearAroundSelf` pass, which uses each
 * dot's actual drawn radius to hold a fixed-px gap at any zoom (so the gap doesn't grow/shrink as
 * you zoom). The input graph is left untouched.
 */
export function withYouNode(g: GraphData, openContents: string[]): GraphData {
  const present = new Set(g.nodes.map((n) => n.id));
  const linked = new Set<string>();
  const openEdges: GraphEdge[] = [];
  for (const content of openContents) {
    const id = contentToNodeId(content);
    if (id == null || id === SELF_NODE_ID || linked.has(id) || !present.has(id)) continue;
    linked.add(id);
    openEdges.push({ from: SELF_NODE_ID, to: id, kind: "open" });
  }
  const you: GraphNode = { id: SELF_NODE_ID, label: "You", kind: "self", position: [0, 0, 0], position2d: [0, 0] };
  return { ...g, nodes: [you, ...g.nodes], edges: [...g.edges, ...openEdges] };
}
