import { describe, expect, test } from "bun:test";
import { buildTree, reconcileTree, type TreeNode } from "./fileTreeModel";
import type { TreeEntry } from "../../core/src/graph";

const entry = (path: string, kind: "file" | "dir" = "file", extra: Partial<TreeEntry> = {}): TreeEntry =>
  ({ path, kind, ...extra }) as TreeEntry;

const child = (node: TreeNode, ...parts: string[]): TreeNode => {
  let cur = node;
  for (const p of parts) cur = cur.children!.get(p)!;
  return cur;
};

/** Build → reconcile against prev → return the settled root (what the memo in FileTree does). */
const settle = (prev: TreeNode | undefined, entries: TreeEntry[]): TreeNode =>
  reconcileTree(prev, buildTree(entries));

describe("reconcileTree", () => {
  test("identical entries → the exact same root reference (deep reuse)", () => {
    const entries = [entry("a", "dir"), entry("a/x.md"), entry("b.md")];
    const r1 = settle(undefined, entries);
    const r2 = settle(r1, entries);
    expect(r2).toBe(r1);
    expect(child(r2, "a")).toBe(child(r1, "a"));
    expect(child(r2, "a", "x.md")).toBe(child(r1, "a", "x.md"));
  });

  test("rename inside a folder busts that folder + root, preserves sibling subtree", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/old.md"), entry("b", "dir"), entry("b/keep.md")]);
    const r2 = settle(r1, [entry("a", "dir"), entry("a/new.md"), entry("b", "dir"), entry("b/keep.md")]);
    expect(r2).not.toBe(r1); // spine busted to the root
    expect(child(r2, "a")).not.toBe(child(r1, "a")); // changed folder gets a fresh ref
    expect(child(r2, "a").children!.has("new.md")).toBe(true);
    expect(child(r2, "a").children!.has("old.md")).toBe(false);
    expect(child(r2, "b")).toBe(child(r1, "b")); // untouched sibling keeps identity
  });

  test("pure removal (size shrinks) busts the spine", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/x.md"), entry("a/y.md")]);
    const r2 = settle(r1, [entry("a", "dir"), entry("a/x.md")]);
    expect(r2).not.toBe(r1);
    expect(child(r2, "a")).not.toBe(child(r1, "a"));
    expect(child(r2, "a").children!.has("y.md")).toBe(false);
    expect(child(r2, "a", "x.md")).toBe(child(r1, "a", "x.md")); // surviving leaf reused
  });

  test("equal-size add+remove swap still busts the parent (no stale reuse)", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/x.md")]);
    const r2 = settle(r1, [entry("a", "dir"), entry("a/z.md")]);
    expect(child(r2, "a")).not.toBe(child(r1, "a"));
    expect(child(r2, "a").children!.has("z.md")).toBe(true);
    expect(child(r2, "a").children!.has("x.md")).toBe(false);
  });

  test("addition deep in a nested folder busts every ancestor, keeps unrelated branches", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/b", "dir"), entry("a/b/x.md"), entry("c", "dir"), entry("c/k.md")]);
    const r2 = settle(r1, [entry("a", "dir"), entry("a/b", "dir"), entry("a/b/x.md"), entry("a/b/y.md"), entry("c", "dir"), entry("c/k.md")]);
    expect(r2).not.toBe(r1);
    expect(child(r2, "a")).not.toBe(child(r1, "a"));
    expect(child(r2, "a", "b")).not.toBe(child(r1, "a", "b"));
    expect(child(r2, "a", "b", "x.md")).toBe(child(r1, "a", "b", "x.md"));
    expect(child(r2, "c")).toBe(child(r1, "c"));
  });

  test("icon change on a leaf busts the leaf + spine; cleared icon too (never stale)", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/x.md", "file", { icon: "Star" })]);
    expect(child(r1, "a", "x.md").icon).toBe("Star");
    const r2 = settle(r1, [entry("a", "dir"), entry("a/x.md", "file", { icon: "Heart" })]);
    expect(child(r2, "a", "x.md")).not.toBe(child(r1, "a", "x.md"));
    expect(child(r2, "a", "x.md").icon).toBe("Heart");
    const r3 = settle(r2, [entry("a", "dir"), entry("a/x.md")]); // icon cleared
    expect(child(r3, "a", "x.md")).not.toBe(child(r2, "a", "x.md"));
    expect(child(r3, "a", "x.md").icon).toBeUndefined();
  });

  test("visibility change on a leaf busts the leaf + spine; cleared visibility too (never stale)", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/x.md", "file", { visibility: "hidden" })]);
    expect(child(r1, "a", "x.md").visibility).toBe("hidden");
    const r2 = settle(r1, [entry("a", "dir"), entry("a/x.md", "file", { visibility: "chat-only" })]);
    expect(child(r2, "a", "x.md")).not.toBe(child(r1, "a", "x.md"));
    expect(child(r2, "a", "x.md").visibility).toBe("chat-only");
    const r3 = settle(r2, [entry("a", "dir"), entry("a/x.md")]); // visibility cleared
    expect(child(r3, "a", "x.md")).not.toBe(child(r2, "a", "x.md"));
    expect(child(r3, "a", "x.md").visibility).toBeUndefined();
  });

  test("a resolved visibility of 'all' is treated as omitted (never carried onto the node)", () => {
    const r1 = settle(undefined, [entry("a", "dir"), entry("a/x.md", "file", { visibility: "all" as any })]);
    expect(child(r1, "a", "x.md").visibility).toBeUndefined();
  });

  test("folder icon change busts the folder ref (contents unchanged children reused inside it)", () => {
    const r1 = settle(undefined, [entry("a", "dir", { icon: "Folder" }), entry("a/x.md")]);
    const r2 = settle(r1, [entry("a", "dir", { icon: "Book" }), entry("a/x.md")]);
    expect(child(r2, "a")).not.toBe(child(r1, "a"));
    expect(child(r2, "a").icon).toBe("Book");
    expect(child(r2, "a", "x.md")).toBe(child(r1, "a", "x.md"));
  });

  test("file ↔ dir flip at the same path busts the node", () => {
    const r1 = settle(undefined, [entry("a")]);
    const r2 = settle(r1, [entry("a", "dir")]);
    expect(child(r2, "a")).not.toBe(child(r1, "a"));
    expect(child(r2, "a").children).toBeInstanceOf(Map);
  });

  test("system-folder label change (daemon rename) busts the node", () => {
    const r1 = settle(undefined, [entry(".daemon", "dir", { isSystemFolder: true, label: "daemon" })]);
    const r2 = settle(r1, [entry(".daemon", "dir", { isSystemFolder: true, label: "Iris" })]);
    expect(child(r2, ".daemon")).not.toBe(child(r1, ".daemon"));
    expect(child(r2, ".daemon").label).toBe("Iris");
    const r3 = settle(r2, [entry(".daemon", "dir", { isSystemFolder: true, label: "Iris" })]);
    expect(r3).toBe(r2);
  });

  test("no previous root → returns the fresh build unchanged", () => {
    const entries = [entry("a", "dir"), entry("a/x.md")];
    const fresh = buildTree(entries);
    expect(reconcileTree(undefined, fresh)).toBe(fresh);
  });
});
