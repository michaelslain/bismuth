// core/test/graphBlock.test.ts
//
// The ```graph embedded block's pure core. The two round-trip suites ARE the feature's
// acceptance property:
//   parse(serialize(spec)).spec deep-equals spec   for a representative set of graphs
//   serialize(parse(md).spec)   ===        md      for canonical markdown
// plus parser shorthand/tolerance and the widget's mutation helpers.

import { describe, expect, test } from "bun:test";
import {
  parseGraphBlock,
  serializeGraphBlock,
  emptyGraphBlock,
  freshNodeId,
  addNode,
  removeNode,
  renameNode,
  setNodeLabel,
  hasEdgeBetween,
  addEdge,
  removeEdgesBetween,
  graphBlockToGraphData,
  type GraphBlockSpec,
} from "../src/graphBlock";

// ---- representative graphs for the spec -> md -> spec direction -------------

const REPRESENTATIVE: Record<string, GraphBlockSpec> = {
  empty: emptyGraphBlock(),
  singleNode: { nodes: [{ id: "alone" }], edges: [] },
  labeledNodes: {
    nodes: [{ id: "a", label: "Alice" }, { id: "b" }, { id: "c", label: "Carol C." }],
    edges: [],
  },
  simpleChain: {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [
      { from: "a", to: "b", directed: true },
      { from: "b", to: "c", directed: true },
    ],
  },
  mixedArrowsAndEdgeLabels: {
    nodes: [{ id: "a", label: "Alice" }, { id: "b" }, { id: "c" }],
    edges: [
      { from: "a", to: "b", directed: true, label: "manages" },
      { from: "b", to: "c", directed: false },
      { from: "c", to: "a", directed: false, label: "peer of" },
    ],
  },
  quotedIds: {
    nodes: [
      { id: "My First Node", label: "Hello" },
      { id: 'she said "hi"' },
      { id: "back\\slash" },
      { id: "a->b" }, // an id CONTAINING an arrow must survive quoting
      { id: "plain" },
    ],
    edges: [
      { from: "My First Node", to: 'she said "hi"', directed: true },
      { from: "a->b", to: "plain", directed: false, label: "weird but legal" },
    ],
  },
  selfLoopAndParallel: {
    nodes: [{ id: "x" }, { id: "y" }],
    edges: [
      { from: "x", to: "x", directed: true },
      { from: "x", to: "y", directed: true },
      { from: "x", to: "y", directed: true }, // parallel edges are preserved, not deduped
      { from: "y", to: "x", directed: false },
    ],
  },
  hyphensDotsSlashes: {
    nodes: [{ id: "my-node.v2" }, { id: "notes/reading" }, { id: "a_b" }],
    edges: [{ from: "my-node.v2", to: "notes/reading", directed: true }],
  },
};

describe("graphBlock round-trip: parse(serialize(spec)) === spec", () => {
  for (const [name, spec] of Object.entries(REPRESENTATIVE)) {
    test(name, () => {
      const md = serializeGraphBlock(spec);
      const { spec: back, errors } = parseGraphBlock(md);
      expect(errors).toEqual([]);
      expect(back).toEqual(spec);
    });
  }

  test("double round-trip is a fixed point (serialize ∘ parse ∘ serialize)", () => {
    for (const spec of Object.values(REPRESENTATIVE)) {
      const md = serializeGraphBlock(spec);
      expect(serializeGraphBlock(parseGraphBlock(md).spec)).toBe(md);
    }
  });
});

describe("graphBlock round-trip: serialize(parse(md)) === md for canonical markdown", () => {
  const CANONICAL = [
    "",
    "alone",
    "a: Alice\nb\na -> b",
    "a: Alice\nb\nc\na -> b: manages\nb -- c\nc -- a: peer of",
    '"My First Node": Hello\n"she said \\"hi\\""\n"My First Node" -> "she said \\"hi\\""',
    "x\ny\nx -> x\nx -> y\nx -> y\ny -- x",
    "my-node.v2\nnotes/reading\nmy-node.v2 -> notes/reading",
  ];
  for (const md of CANONICAL) {
    test(JSON.stringify(md.slice(0, 40)), () => {
      const { spec, errors } = parseGraphBlock(md);
      expect(errors).toEqual([]);
      expect(serializeGraphBlock(spec)).toBe(md);
    });
  }
});

describe("parseGraphBlock shorthand + tolerance", () => {
  test("edges declare their endpoints implicitly, in first-mention order", () => {
    const { spec, errors } = parseGraphBlock("a -> b\nc -- a");
    expect(errors).toEqual([]);
    expect(spec.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(spec.edges).toEqual([
      { from: "a", to: "b", directed: true },
      { from: "c", to: "a", directed: false },
    ]);
  });

  test("a later node line can label an implicitly-created node", () => {
    const { spec, errors } = parseGraphBlock("a -> b\nb: Bob");
    expect(errors).toEqual([]);
    expect(spec.nodes).toEqual([{ id: "a" }, { id: "b", label: "Bob" }]);
  });

  test("blank lines and # comments are skipped", () => {
    const { spec, errors } = parseGraphBlock("\n# my diagram\na -> b\n\n   # trailing comment\n");
    expect(errors).toEqual([]);
    expect(spec.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(spec.edges.length).toBe(1);
  });

  test("arrows work without surrounding spaces", () => {
    const { spec, errors } = parseGraphBlock("a->b\nc--d");
    expect(errors).toEqual([]);
    expect(spec.edges).toEqual([
      { from: "a", to: "b", directed: true },
      { from: "c", to: "d", directed: false },
    ]);
  });

  test("labels keep interior punctuation and are trimmed", () => {
    const { spec } = parseGraphBlock("a:   Alice: the first   \na -> a:  self, loop ");
    expect(spec.nodes[0]).toEqual({ id: "a", label: "Alice: the first" });
    expect(spec.edges[0].label).toBe("self, loop");
  });

  test("bad statements are reported with 1-based line numbers and skipped", () => {
    const { spec, errors } = parseGraphBlock("a -> b\na -> \n\"unterminated\nok");
    expect(spec.nodes.map((n) => n.id)).toEqual(["a", "b", "ok"]);
    expect(spec.edges.length).toBe(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
  });

  test("duplicate explicit node declarations error", () => {
    const { errors } = parseGraphBlock("a: One\na: Two");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("duplicate");
  });

  test("empty label errors", () => {
    const { errors } = parseGraphBlock("a:   ");
    expect(errors.length).toBe(1);
  });
});

describe("graphBlock mutations (the widget's edit affordances)", () => {
  const base: GraphBlockSpec = {
    nodes: [{ id: "a", label: "Alice" }, { id: "b" }],
    edges: [{ from: "a", to: "b", directed: true }],
  };

  test("freshNodeId avoids collisions", () => {
    expect(freshNodeId(emptyGraphBlock())).toBe("node");
    const taken: GraphBlockSpec = { nodes: [{ id: "node" }, { id: "node-2" }], edges: [] };
    expect(freshNodeId(taken)).toBe("node-3");
  });

  test("addNode appends and returns the new id; original spec untouched", () => {
    const { spec, id } = addNode(base);
    expect(id).toBe("node");
    expect(spec.nodes.map((n) => n.id)).toEqual(["a", "b", "node"]);
    expect(base.nodes.length).toBe(2);
  });

  test("removeNode drops the node and every incident edge", () => {
    const spec = removeNode(base, "a");
    expect(spec.nodes).toEqual([{ id: "b" }]);
    expect(spec.edges).toEqual([]);
  });

  test("renameNode rewires edges and keeps the label", () => {
    const spec = renameNode(base, "a", "alpha");
    expect(spec.nodes[0]).toEqual({ id: "alpha", label: "Alice" });
    expect(spec.edges[0]).toEqual({ from: "alpha", to: "b", directed: true });
  });

  test("renameNode rejects collisions and empty ids (spec unchanged)", () => {
    expect(renameNode(base, "a", "b")).toBe(base);
    expect(renameNode(base, "a", "   ")).toBe(base);
    expect(renameNode(base, "missing", "x")).toBe(base);
  });

  test("setNodeLabel sets and clears", () => {
    const labeled = setNodeLabel(base, "b", "Bob");
    expect(labeled.nodes[1]).toEqual({ id: "b", label: "Bob" });
    const cleared = setNodeLabel(labeled, "b", "  ");
    expect(cleared.nodes[1]).toEqual({ id: "b" });
  });

  test("addEdge / hasEdgeBetween / removeEdgesBetween", () => {
    expect(hasEdgeBetween(base, "b", "a")).toBe(true); // either direction
    const withUndirected = addEdge(base, "b", "a", false);
    expect(withUndirected.edges.length).toBe(2);
    expect(addEdge(base, "a", "ghost")).toBe(base); // unknown endpoint → unchanged
    const cleared = removeEdgesBetween(withUndirected, "a", "b");
    expect(cleared.edges).toEqual([]);
    expect(cleared.nodes).toBe(base.nodes);
  });

  test("every mutation result still round-trips", () => {
    const specs = [
      addNode(base, "New").spec,
      removeNode(base, "b"),
      renameNode(base, "a", "alpha"),
      setNodeLabel(base, "b", "Bob"),
      addEdge(base, "b", "a", false),
      removeEdgesBetween(base, "a", "b"),
    ];
    for (const spec of specs) {
      expect(parseGraphBlock(serializeGraphBlock(spec)).spec).toEqual(spec);
    }
  });
});

describe("graphBlockToGraphData", () => {
  test("maps nodes to note dots (label defaults to id) and edges to links", () => {
    const g = graphBlockToGraphData({
      nodes: [{ id: "a", label: "Alice" }, { id: "b" }],
      edges: [{ from: "a", to: "b", directed: true, label: "x" }],
    });
    expect(g.nodes).toEqual([
      { id: "a", label: "Alice", kind: "note" },
      { id: "b", label: "b", kind: "note" },
    ]);
    expect(g.edges).toEqual([{ from: "a", to: "b", kind: "link" }]);
  });
});
