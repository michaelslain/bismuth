// core/src/graphBlock.ts
//
// The ```graph embedded block: a small, human-writable DSL describing a CUSTOM graph
// (nodes + edges) inside a note body, rendered inline by the editor (app/src/editor/
// graphBlock.ts → app/src/graph/EmbeddedGraph.tsx) with the same canvas renderer as the
// knowledge graph. This module is the block's PURE core — parser, serializer, and the
// mutation helpers the interactive widget uses to edit the graph — so the whole
// markdown ⇄ graph round-trip is headless and unit-tested (core/test/graphBlock.test.ts).
//
// The round-trip contract (the feature's acceptance property):
//   parseGraphBlock(serializeGraphBlock(spec)).spec  deep-equals  spec   (for well-formed specs)
//   serializeGraphBlock(parseGraphBlock(md).spec)    ===          md     (for canonical md)
//
// Grammar (one statement per line; blank lines and `# comment` lines are skipped):
//   node line:  <token>              — declare a node
//               <token>: <label>     — declare a node with a display label (rest of line)
//   edge line:  <token> -> <token>   — directed edge (endpoints are declared implicitly)
//               <token> -- <token>   — undirected edge
//               … : <label>          — optional edge label (rest of line)
//   token:      a bare word of [A-Za-z0-9_.-/] (not containing "->"/"--"), or a
//               double-quoted string with \" and \\ escapes for anything else.
//
// CANONICAL form (what serializeGraphBlock emits, and what the widget writes back):
// every node as its own line first (in model order), then every edge (in model order),
// labels separated by ": ". Explicit node lines make the serializer lossless — node
// order and labels never depend on edge-mention order. The parser additionally accepts
// the terse human shorthand (edges implying their endpoints), which simply parses to a
// spec whose canonical form is more explicit.

import type { GraphData } from "./graph";

export interface GraphBlockNode {
  id: string;
  /** Display label; the id itself is shown when absent. Trimmed, never empty. */
  label?: string;
}

export interface GraphBlockEdge {
  from: string;
  to: string;
  /** true = `->`, false = `--`. Kept in the model so the round-trip is lossless. */
  directed: boolean;
  label?: string;
}

export interface GraphBlockSpec {
  nodes: GraphBlockNode[];
  edges: GraphBlockEdge[];
}

export interface GraphBlockError {
  /** 1-based line number within the block body. */
  line: number;
  message: string;
}

export interface GraphBlockParseResult {
  spec: GraphBlockSpec;
  errors: GraphBlockError[];
}

export function emptyGraphBlock(): GraphBlockSpec {
  return { nodes: [], edges: [] };
}

// ---- tokens ----------------------------------------------------------------

const BARE_CHAR = /[A-Za-z0-9_.\-/]/;

/** Can `id` be serialized as a bare (unquoted) token and parse back to itself? */
function isBareToken(id: string): boolean {
  if (id.length === 0) return false;
  if (id.includes("->") || id.includes("--")) return false; // would read as an arrow
  for (const ch of id) if (!BARE_CHAR.test(ch)) return false;
  return true;
}

function quoteToken(id: string): string {
  if (isBareToken(id)) return id;
  return '"' + id.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

interface TokenScan { value: string; next: number }

/** Scan one token starting at `i` (caller has skipped whitespace). Returns null on a
 *  malformed token (unterminated quote / no token characters at `i`). */
function scanToken(line: string, i: number): TokenScan | null {
  if (line[i] === '"') {
    let out = "";
    let j = i + 1;
    while (j < line.length) {
      const ch = line[j];
      if (ch === "\\" && j + 1 < line.length) { out += line[j + 1]; j += 2; continue; }
      if (ch === '"') return { value: out, next: j + 1 };
      out += ch; j++;
    }
    return null; // unterminated quote
  }
  let j = i;
  while (j < line.length && BARE_CHAR.test(line[j])) {
    // A "-" that starts an arrow ("->" / "--") terminates the bare token, so `a->b`
    // and `a--b` read as edges. Ids that CONTAIN an arrow must be quoted.
    if (line[j] === "-" && (line[j + 1] === ">" || line[j + 1] === "-")) break;
    j++;
  }
  if (j === i) return null;
  return { value: line.slice(i, j), next: j };
}

function skipWs(line: string, i: number): number {
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i;
}

// ---- parser ----------------------------------------------------------------

type Statement =
  | { kind: "node"; id: string; label?: string }
  | { kind: "edge"; from: string; to: string; directed: boolean; label?: string };

function parseStatement(line: string): Statement | { error: string } | null {
  let i = skipWs(line, 0);
  if (i >= line.length) return null; // blank
  if (line[i] === "#") return null;  // comment line
  const first = scanToken(line, i);
  if (!first) return { error: `expected a node id (a bare word or a "quoted" string)` };
  i = skipWs(line, first.next);

  // arrow → edge statement
  const two = line.slice(i, i + 2);
  if (two === "->" || two === "--") {
    i = skipWs(line, i + 2);
    const second = scanToken(line, i);
    if (!second) return { error: `expected a target node id after "${two}"` };
    i = skipWs(line, second.next);
    const label = parseLabel(line, i);
    if (typeof label === "object") return label;
    return { kind: "edge", from: first.value, to: second.value, directed: two === "->", label };
  }

  const label = parseLabel(line, i);
  if (typeof label === "object") return label;
  return { kind: "node", id: first.value, label };
}

/** Parse the optional trailing `: <label>` (label = rest of line, trimmed). Returns the
 *  label string, undefined when absent, or an error object. */
function parseLabel(line: string, i: number): string | undefined | { error: string } {
  if (i >= line.length) return undefined;
  if (line[i] !== ":") return { error: `unexpected text ${JSON.stringify(line.slice(i))} — expected "->", "--", or ": label"` };
  const label = line.slice(i + 1).trim();
  if (!label) return { error: "empty label after ':'" };
  return label;
}

/**
 * Parse a ```graph block body into a GraphBlockSpec. Tolerant: statements that fail to
 * parse are reported in `errors` (1-based body line numbers) and skipped, so a partially
 * valid block still renders. Edge endpoints not declared by a node line are created
 * implicitly in first-mention order.
 */
export function parseGraphBlock(body: string): GraphBlockParseResult {
  const nodes: GraphBlockNode[] = [];
  const edges: GraphBlockEdge[] = [];
  const byId = new Map<string, { node: GraphBlockNode; explicit: boolean }>();
  const errors: GraphBlockError[] = [];

  const ensureNode = (id: string): void => {
    if (byId.has(id)) return;
    const node: GraphBlockNode = { id };
    byId.set(id, { node, explicit: false });
    nodes.push(node);
  };

  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const stmt = parseStatement(lines[li]);
    if (stmt === null) continue;
    if ("error" in stmt) { errors.push({ line: li + 1, message: stmt.error }); continue; }
    if (stmt.kind === "node") {
      const existing = byId.get(stmt.id);
      if (existing?.explicit) { errors.push({ line: li + 1, message: `duplicate node "${stmt.id}"` }); continue; }
      if (existing) {
        existing.explicit = true;
        if (stmt.label !== undefined) existing.node.label = stmt.label;
      } else {
        const node: GraphBlockNode = stmt.label !== undefined ? { id: stmt.id, label: stmt.label } : { id: stmt.id };
        byId.set(stmt.id, { node, explicit: true });
        nodes.push(node);
      }
    } else {
      ensureNode(stmt.from);
      ensureNode(stmt.to);
      const edge: GraphBlockEdge = { from: stmt.from, to: stmt.to, directed: stmt.directed };
      if (stmt.label !== undefined) edge.label = stmt.label;
      edges.push(edge);
    }
  }
  return { spec: { nodes, edges }, errors };
}

// ---- serializer ------------------------------------------------------------

/**
 * Serialize a spec to its canonical block body: one line per node (in model order, with
 * `: label` when labeled), then one line per edge. parseGraphBlock() of the result
 * reproduces the spec exactly (node order included) — see the round-trip tests.
 */
export function serializeGraphBlock(spec: GraphBlockSpec): string {
  const lines: string[] = [];
  for (const n of spec.nodes) lines.push(n.label !== undefined ? `${quoteToken(n.id)}: ${n.label}` : quoteToken(n.id));
  for (const e of spec.edges) {
    const arrow = e.directed ? "->" : "--";
    const head = `${quoteToken(e.from)} ${arrow} ${quoteToken(e.to)}`;
    lines.push(e.label !== undefined ? `${head}: ${e.label}` : head);
  }
  return lines.join("\n");
}

// ---- mutations (pure; each returns a NEW spec) ------------------------------

/** A fresh node id not colliding with any existing one: `node`, `node-2`, `node-3`, … */
export function freshNodeId(spec: GraphBlockSpec, base = "node"): string {
  const taken = new Set(spec.nodes.map((n) => n.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

export function addNode(spec: GraphBlockSpec, label?: string): { spec: GraphBlockSpec; id: string } {
  const id = freshNodeId(spec);
  const node: GraphBlockNode = label?.trim() ? { id, label: label.trim() } : { id };
  return { spec: { nodes: [...spec.nodes, node], edges: spec.edges }, id };
}

/** Remove a node and every edge touching it. */
export function removeNode(spec: GraphBlockSpec, id: string): GraphBlockSpec {
  return {
    nodes: spec.nodes.filter((n) => n.id !== id),
    edges: spec.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

/** Rename a node id, rewiring its edges. Returns the spec UNCHANGED when the rename is
 *  invalid (missing node, empty/whitespace new id, or a collision with another node). */
export function renameNode(spec: GraphBlockSpec, id: string, newIdRaw: string): GraphBlockSpec {
  const newId = newIdRaw.trim();
  if (!newId || newId === id) return spec;
  if (!spec.nodes.some((n) => n.id === id)) return spec;
  if (spec.nodes.some((n) => n.id === newId)) return spec;
  return {
    nodes: spec.nodes.map((n) => (n.id === id ? { ...n, id: newId } : n)),
    edges: spec.edges.map((e) => ({
      ...e,
      from: e.from === id ? newId : e.from,
      to: e.to === id ? newId : e.to,
    })),
  };
}

/** Set (or, with an empty/whitespace label, clear) a node's display label. */
export function setNodeLabel(spec: GraphBlockSpec, id: string, labelRaw: string): GraphBlockSpec {
  const label = labelRaw.trim();
  return {
    nodes: spec.nodes.map((n) => {
      if (n.id !== id) return n;
      return label ? { ...n, label } : { id: n.id };
    }),
    edges: spec.edges,
  };
}

/** Is there any edge between `a` and `b`, in either direction? */
export function hasEdgeBetween(spec: GraphBlockSpec, a: string, b: string): boolean {
  return spec.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

export function addEdge(spec: GraphBlockSpec, from: string, to: string, directed = true): GraphBlockSpec {
  if (!spec.nodes.some((n) => n.id === from) || !spec.nodes.some((n) => n.id === to)) return spec;
  return { nodes: spec.nodes, edges: [...spec.edges, { from, to, directed }] };
}

/** Remove EVERY edge between `a` and `b` (either direction). */
export function removeEdgesBetween(spec: GraphBlockSpec, a: string, b: string): GraphBlockSpec {
  return {
    nodes: spec.nodes,
    edges: spec.edges.filter((e) => !((e.from === a && e.to === b) || (e.from === b && e.to === a))),
  };
}

// ---- rendering bridge -------------------------------------------------------

/**
 * Project the block spec onto the shared GraphData shape so the embedded widget can feed
 * the ordinary graph stack (core/layout.ts + CanvasGraphRenderer) unchanged. Nodes render
 * as "note" dots (labels default to the id); edges as plain "link" lines.
 */
export function graphBlockToGraphData(spec: GraphBlockSpec): GraphData {
  return {
    nodes: spec.nodes.map((n) => ({ id: n.id, label: n.label ?? n.id, kind: "note" as const })),
    edges: spec.edges.map((e) => ({ from: e.from, to: e.to, kind: "link" as const })),
  };
}
