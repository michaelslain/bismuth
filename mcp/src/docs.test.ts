// mcp/src/docs.test.ts
// Tests for docs.ts: the token-frugal docs/ reference reader (list / search / read).
// Self-contained — builds a throwaway docs dir, no network, no repo docs/ dependency.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDocs, searchDocs, readDoc } from "./docs";

let root: string;

// A tiny docs tree: two top-level docs + one nested doc, each with a leading
// `# Title` heading, section headings, and a distinctive search term.
const GETTING_STARTED = `# Getting Started

Welcome to Bismuth, a personal knowledge management system.

## Installation

Run \`bun install\` to set up every workspace at once.

## Configuration

Set the OA_VAULT environment variable before launching the dev server.
The flux-capacitor must be calibrated for time travel to work.
`;

const GRAPH_GUIDE = `# Graph Guide

The knowledge graph renders your notes as an interactive web.

## Layouts

Positions are precomputed on the backend; the renderer only morphs between them.

## Modes

Switch between the second-brain, third-brain, and agents views.
`;

const RELAY_NOTES = `# Relay Notes

The relay plugin reports terminal-tab sessions to the in-process registry.

## Hooks

SessionStart and UserPromptSubmit register and heartbeat each session.

### Deep Detail

A nested h3 heading whose depth must round-trip through readDoc unchanged.
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "oa-mcp-docs-"));
  writeFileSync(join(root, "getting-started.md"), GETTING_STARTED);
  writeFileSync(join(root, "graph-guide.md"), GRAPH_GUIDE);
  mkdirSync(join(root, "internals"), { recursive: true });
  writeFileSync(join(root, "internals", "relay.md"), RELAY_NOTES);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("listDocs returns every doc with relative paths and # titles", () => {
  const docs = listDocs(root);
  expect(Array.isArray(docs)).toBe(true);
  expect(docs.length).toBe(3);

  const byPath = new Map(docs.map((d) => [d.path, d]));
  // Paths are relative to the docs root (no leading slash, no temp-dir prefix).
  expect(byPath.has("getting-started.md")).toBe(true);
  expect(byPath.has("graph-guide.md")).toBe(true);
  // Nested docs use forward-slash relative paths.
  const nestedKey = [...byPath.keys()].find((p) => p.endsWith("relay.md"))!;
  expect(nestedKey).toBeDefined();
  expect(nestedKey).not.toContain(root);
  expect(nestedKey).toContain("internals");
  expect(nestedKey).not.toContain("\\"); // forward slashes only

  // Titles come from the leading "# " heading, not the filename.
  expect(byPath.get("getting-started.md")!.title).toBe("Getting Started");
  expect(byPath.get("graph-guide.md")!.title).toBe("Graph Guide");
  expect(byPath.get(nestedKey)!.title).toBe("Relay Notes");
});

test("searchDocs finds a section by a known term with path, snippet, and score", () => {
  const hits = searchDocs(root, "flux-capacitor");
  expect(Array.isArray(hits)).toBe(true);
  expect(hits.length).toBeGreaterThan(0);

  const hit = hits[0];
  // The term only appears in getting-started.md's Configuration section, so the
  // hit path points at that doc + its heading anchor.
  expect(hit.path).toBe("getting-started.md#configuration");
  expect(hit.heading).toBe("Configuration");
  expect(typeof hit.snippet).toBe("string");
  expect(hit.snippet.length).toBeGreaterThan(0);
  expect(hit.snippet.toLowerCase()).toContain("flux-capacitor");
  expect(hit.score).toBeGreaterThan(0);
});

test("searchDocs ranks the most relevant doc first for a shared term", () => {
  // "registry" lives only in relay.md's intro section (before any ## heading),
  // so the top hit's path is the bare relative path with no #anchor.
  const hits = searchDocs(root, "registry");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].path).toBe("internals/relay.md");
  expect(hits[0].path).not.toContain("#");
  expect(hits[0].score).toBeGreaterThan(0);
});

test("searchDocs respects the limit", () => {
  // "the" appears across all three docs; without a cap we'd get multiple hits.
  const uncapped = searchDocs(root, "the");
  expect(uncapped.length).toBeGreaterThan(1);

  const capped = searchDocs(root, "the", 1);
  expect(capped.length).toBe(1);
  expect(capped.length).toBeLessThanOrEqual(uncapped.length);
});

test("readDoc returns the full document content", () => {
  const content = readDoc(root, "getting-started.md");
  expect(content).toBe(GETTING_STARTED);
  expect(content).toContain("# Getting Started");
  expect(content).toContain("## Installation");
  expect(content).toContain("## Configuration");
});

test("readDoc with a section returns only that section", () => {
  const section = readDoc(root, "getting-started.md", "Configuration");
  expect(section).toContain("OA_VAULT");
  expect(section).toContain("flux-capacitor");
  // Scoped to the requested section — earlier sections are excluded.
  expect(section).not.toContain("bun install");
  expect(section).not.toContain("Welcome to Bismuth");
  // And shorter than the full doc.
  expect(section.length).toBeLessThan(GETTING_STARTED.length);
});

test("readDoc preserves the source heading depth (### stays ###)", () => {
  const section = readDoc(root, "internals/relay.md", "Deep Detail");
  // The h3's depth must round-trip — not be flattened to "## ".
  expect(section.startsWith("### Deep Detail")).toBe(true);
  expect(section.startsWith("## Deep Detail")).toBe(false);
  expect(section).toContain("must round-trip");
});

test("readDoc rejects a path-traversal attempt", () => {
  // A secret living outside the docs root must stay unreachable.
  const secret = join(root, "..", "oa-mcp-secret.md");
  writeFileSync(secret, "# Secret\ntop secret payload");
  try {
    expect(() => readDoc(root, "../oa-mcp-secret.md")).toThrow();
  } finally {
    rmSync(secret, { force: true });
  }
});

test("readDoc throws for a missing file", () => {
  expect(() => readDoc(root, "does-not-exist.md")).toThrow();
});
