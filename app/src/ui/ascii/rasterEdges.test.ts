import { describe, it, expect } from "bun:test";
import { rasterEdges, clearNoiseUnderEdges, type GraphNode } from "./rasterEdges";

describe("rasterEdges", () => {
  it("draws a horizontal edge as '-', with '+' at the endpoints", () => {
    const nodes: GraphNode[] = [{ x: 0, y: 1 }, { x: 4, y: 1 }];
    const grid = rasterEdges(5, 3, nodes, [[0, 1]]);
    const rows = grid.split("\n");
    expect(rows[1]).toBe("+---+");
    expect(rows[0]).toBe("     ");
    expect(rows[2]).toBe("     ");
  });

  it("draws a vertical edge as '|', with '+' at the endpoints", () => {
    const nodes: GraphNode[] = [{ x: 1, y: 0 }, { x: 1, y: 3 }];
    const grid = rasterEdges(3, 4, nodes, [[0, 1]]);
    const col1 = grid
      .split("\n")
      .map((row) => row[1])
      .join("");
    expect(col1).toBe("+||+");
  });

  it("draws a bottom-left-to-top-right diagonal as '/'", () => {
    const nodes: GraphNode[] = [{ x: 0, y: 3 }, { x: 3, y: 0 }];
    const grid = rasterEdges(4, 4, nodes, [[0, 1]]);
    expect(grid).toContain("/");
    expect(grid).not.toContain("\\");
  });

  it("draws a top-left-to-bottom-right diagonal as '\\'", () => {
    const nodes: GraphNode[] = [{ x: 0, y: 0 }, { x: 3, y: 3 }];
    const grid = rasterEdges(4, 4, nodes, [[0, 1]]);
    expect(grid).toContain("\\");
    expect(grid).not.toContain("/");
  });

  it("stamps every node as '+' — a junction overwrites whatever an edge drew under it", () => {
    // Three colinear nodes; the edge from node 0 to node 2 passes straight
    // through node 1's cell, but node 1 isn't an endpoint of that edge.
    const nodes: GraphNode[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }];
    const grid = rasterEdges(5, 1, nodes, [[0, 2]]);
    expect(grid).toBe("+-+-+");
  });

  it("marks a real crossing (two edges sharing a node) with '+' at the shared node", () => {
    const nodes: GraphNode[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 }];
    const grid = rasterEdges(5, 3, nodes, [
      [0, 1],
      [1, 3],
      [1, 2],
    ]);
    const rows = grid.split("\n");
    expect(rows[0][2]).toBe("+");
  });

  it("skips edges that reference an out-of-range node index, without throwing", () => {
    const nodes: GraphNode[] = [{ x: 0, y: 0 }];
    expect(() => rasterEdges(3, 3, nodes, [[0, 5]])).not.toThrow();
    const grid = rasterEdges(3, 3, nodes, [[0, 5]]);
    expect(grid).toBe("+  \n   \n   ");
  });

  it("clips out-of-bounds node coordinates instead of wrapping or throwing", () => {
    // Both nodes — and the whole line between them — sit entirely outside a
    // 4x4 grid, so nothing should be written anywhere.
    const nodes: GraphNode[] = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
    expect(() => rasterEdges(4, 4, nodes, [[0, 1]])).not.toThrow();
    const grid = rasterEdges(4, 4, nodes, [[0, 1]]);
    expect(grid).toBe("    \n    \n    \n    ");
  });

  it("clips a single out-of-bounds node (no edges) without wrapping to a visible cell", () => {
    const nodes: GraphNode[] = [{ x: -5, y: -5 }, { x: 99, y: 99 }];
    const grid = rasterEdges(4, 4, nodes, []);
    expect(grid).toBe("    \n    \n    \n    ");
  });

  it("returns a blank grid for no nodes and no edges", () => {
    expect(rasterEdges(3, 2, [], [])).toBe("   \n   ");
  });
});

describe("clearNoiseUnderEdges", () => {
  it("blanks every cell where the edges layer drew a non-space character", () => {
    const noise = "abc\ndef";
    const edges = " - \n   ";
    expect(clearNoiseUnderEdges(noise, edges)).toBe("a c\ndef");
  });

  it("leaves noise untouched when the edges layer is entirely blank", () => {
    expect(clearNoiseUnderEdges("xyz", "   ")).toBe("xyz");
  });

  it("clears a full row of noise under a full row of edges", () => {
    expect(clearNoiseUnderEdges("XXXXX", "+---+")).toBe("     ");
  });

  it("handles a shorter edges row by leaving the uncovered tail of noise alone", () => {
    expect(clearNoiseUnderEdges("abcde", "-")).toBe(" bcde");
  });
});
