import { test, expect, describe } from "bun:test";
import { leafIsFileStructuralOnly, hasPropertyFilters, changeAffectsView, type ViewDeps } from "./changeRelevance";
import type { ServerChange } from "../serverVersion";

describe("leafIsFileStructuralOnly", () => {
  test("file.* tag/folder/name leaves are structural", () => {
    expect(leafIsFileStructuralOnly('file.inFolder("tasks")')).toBe(true);
    expect(leafIsFileStructuralOnly('file.hasTag("tasks")')).toBe(true);
    expect(leafIsFileStructuralOnly('!file.hasTag("habit")')).toBe(true);
    expect(leafIsFileStructuralOnly('file.name != "Do Now"')).toBe(true);
    expect(leafIsFileStructuralOnly('file.hasLink("X")')).toBe(true);
  });
  test("string literals aren't mistaken for property identifiers", () => {
    // "note.status" appears only inside a quoted name → still structural
    expect(leafIsFileStructuralOnly('file.name == "note.status thing"')).toBe(true);
  });
  test("property-value leaves are content-dependent", () => {
    expect(leafIsFileStructuralOnly('note.status == "active"')).toBe(false);
    expect(leafIsFileStructuralOnly("due < today()")).toBe(false);
    expect(leafIsFileStructuralOnly("price > 10")).toBe(false);
    expect(leafIsFileStructuralOnly('formula.score > 3')).toBe(false);
  });
});

describe("hasPropertyFilters", () => {
  test("undefined / pure file.* trees → false", () => {
    expect(hasPropertyFilters(undefined)).toBe(false);
    expect(hasPropertyFilters({ and: ['file.inFolder("tasks")', 'file.hasTag("tasks")', '!file.hasTag("habit")'] })).toBe(false);
  });
  test("a property leaf anywhere in the tree → true", () => {
    expect(hasPropertyFilters({ and: ['file.hasTag("x")', { or: ["status == 'a'"] }] })).toBe(true);
    expect(hasPropertyFilters("note.rating >= 4")).toBe(true);
  });
});

const change = (paths: string[], dirty?: { graph: boolean; tree: boolean }): ServerChange => ({ version: 1, paths, dirty });
const fileOnlyDeps = (rowPaths: string[]): ViewDeps => ({
  baseFilters: { and: ['file.inFolder("tasks")', 'file.hasTag("tasks")'] },
  viewFilters: [undefined],
  spec: { kind: "notes" },
  relevantPaths: new Set(rowPaths),
});

describe("changeAffectsView", () => {
  test("memory-only change (paths empty, graph dirty, tree clean) is skipped", () => {
    expect(changeAffectsView(change([], { graph: true, tree: false }), fileOnlyDeps(["a.md"]))).toBe(false);
  });
  test("DAEMON.md-style content-only edit to an unrelated file is skipped for a file-only base", () => {
    expect(changeAffectsView(change(["DAEMON.md"], { graph: false, tree: false }), fileOnlyDeps(["tasks/a.md"]))).toBe(false);
  });
  test("content-only edit to one of the view's own rows revalidates", () => {
    expect(changeAffectsView(change(["tasks/a.md"], { graph: false, tree: false }), fileOnlyDeps(["tasks/a.md"]))).toBe(true);
  });
  test("structural (tree) and tag/link (graph) changes always revalidate", () => {
    expect(changeAffectsView(change(["new.md"], { graph: false, tree: true }), fileOnlyDeps(["tasks/a.md"]))).toBe(true);
    expect(changeAffectsView(change(["x.md"], { graph: true, tree: false }), fileOnlyDeps(["tasks/a.md"]))).toBe(true);
  });
  test("poll catch-up (no dirty) and not-yet-resolved (null deps) revalidate", () => {
    expect(changeAffectsView(change([]), fileOnlyDeps(["a.md"]))).toBe(true);
    expect(changeAffectsView(change(["x.md"], { graph: false, tree: false }), null)).toBe(true);
  });
  test("property-filtered base revalidates on ANY content-only edit (correctness over the skip)", () => {
    const deps: ViewDeps = { baseFilters: "note.status == 'active'", viewFilters: [undefined], spec: { kind: "notes" }, relevantPaths: new Set(["a.md"]) };
    expect(changeAffectsView(change(["DAEMON.md"], { graph: false, tree: false }), deps)).toBe(true);
  });
  test("scoped (from:) and composed (base ref:) sources revalidate on content-only edits", () => {
    const scoped: ViewDeps = { viewFilters: [], spec: { kind: "tasks", from: "[[Scope]]" }, relevantPaths: new Set(["a.md"]) };
    expect(changeAffectsView(change(["other.md"], { graph: false, tree: false }), scoped)).toBe(true);
    const composed: ViewDeps = { viewFilters: [], spec: { kind: "base", ref: "[[Other Base]]" }, relevantPaths: new Set(["a.md"]) };
    expect(changeAffectsView(change(["other.md"], { graph: false, tree: false }), composed)).toBe(true);
  });
  test("a `where` with property refs revalidates; a file-only `where` keeps the skip", () => {
    const propWhere: ViewDeps = { viewFilters: [], spec: { kind: "notes", where: "rating > 3" }, relevantPaths: new Set(["a.md"]) };
    expect(changeAffectsView(change(["DAEMON.md"], { graph: false, tree: false }), propWhere)).toBe(true);
    const fileWhere: ViewDeps = { viewFilters: [], spec: { kind: "notes", where: 'file.hasTag("x")' }, relevantPaths: new Set(["a.md"]) };
    expect(changeAffectsView(change(["DAEMON.md"], { graph: false, tree: false }), fileWhere)).toBe(false);
  });
});
