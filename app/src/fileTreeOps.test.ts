// app/src/fileTreeOps.test.ts
import { test, expect } from "bun:test";
import { renameEntries, removeEntries, addEntry, uniqueChildName } from "./fileTreeOps";
import type { TreeEntry } from "../../core/src/graph";

const sample = (): TreeEntry[] => [
  { path: "a.md", kind: "file" },
  { path: "notes", kind: "dir" },
  { path: "notes/b.md", kind: "file", icon: "📌" },
  { path: "notes/sub", kind: "dir" },
  { path: "notes/sub/c.md", kind: "file" },
];

test("renameEntries renames a single file in place", () => {
  const out = renameEntries(sample(), "a.md", "renamed.md");
  expect(out.find((e) => e.path === "a.md")).toBeUndefined();
  expect(out.find((e) => e.path === "renamed.md")?.kind).toBe("file");
});

test("renameEntries moving a folder rewrites the folder and all descendants", () => {
  const out = renameEntries(sample(), "notes", "journal");
  const paths = out.map((e) => e.path).sort();
  expect(paths).toEqual(["a.md", "journal", "journal/b.md", "journal/sub", "journal/sub/c.md"]);
});

test("renameEntries preserves icon and kind on the renamed entry", () => {
  const out = renameEntries(sample(), "notes/b.md", "notes/renamed.md");
  const moved = out.find((e) => e.path === "notes/renamed.md");
  expect(moved?.icon).toBe("📌");
  expect(moved?.kind).toBe("file");
});

test("renameEntries does not touch a sibling whose path is a prefix-but-not-segment", () => {
  // "notes2" shares the "notes" prefix but is a different entry — must not be rewritten.
  const entries: TreeEntry[] = [
    { path: "notes", kind: "dir" },
    { path: "notes2", kind: "dir" },
  ];
  const out = renameEntries(entries, "notes", "journal");
  expect(out.map((e) => e.path).sort()).toEqual(["journal", "notes2"]);
});

test("removeEntries drops a file", () => {
  const out = removeEntries(sample(), "a.md");
  expect(out.some((e) => e.path === "a.md")).toBe(false);
  expect(out.length).toBe(sample().length - 1);
});

test("removeEntries drops a folder and all its descendants", () => {
  const out = removeEntries(sample(), "notes");
  expect(out.map((e) => e.path)).toEqual(["a.md"]);
});

test("removeEntries does not drop a prefix-but-not-segment sibling", () => {
  const entries: TreeEntry[] = [
    { path: "notes", kind: "dir" },
    { path: "notes2", kind: "dir" },
  ];
  const out = removeEntries(entries, "notes");
  expect(out.map((e) => e.path)).toEqual(["notes2"]);
});

test("addEntry appends a new file entry", () => {
  const out = addEntry(sample(), "new.md", "file");
  expect(out.find((e) => e.path === "new.md")?.kind).toBe("file");
});

test("addEntry appends a new dir entry", () => {
  const out = addEntry(sample(), "fresh", "dir");
  expect(out.find((e) => e.path === "fresh")?.kind).toBe("dir");
});

test("addEntry is a no-op when the path already exists", () => {
  const out = addEntry(sample(), "a.md", "file");
  expect(out.filter((e) => e.path === "a.md").length).toBe(1);
});

test("uniqueChildName returns the name unchanged when nothing collides", () => {
  expect(uniqueChildName(sample(), "", "Untitled.md")).toBe("Untitled.md");
  expect(uniqueChildName(sample(), "notes", "Untitled.md")).toBe("Untitled.md");
});

test("uniqueChildName appends ' 1' to the stem (before the extension) on a collision", () => {
  const entries: TreeEntry[] = [{ path: "Untitled.md", kind: "file" }];
  expect(uniqueChildName(entries, "", "Untitled.md")).toBe("Untitled 1.md");
});

test("uniqueChildName walks ' 1', ' 2', … past consecutive collisions", () => {
  const entries: TreeEntry[] = [
    { path: "Untitled.md", kind: "file" },
    { path: "Untitled 1.md", kind: "file" },
    { path: "Untitled 2.md", kind: "file" },
  ];
  expect(uniqueChildName(entries, "", "Untitled.md")).toBe("Untitled 3.md");
});

test("uniqueChildName scopes collisions to the parent dir", () => {
  // "Untitled.md" exists only at the root → free inside "notes".
  const entries: TreeEntry[] = [{ path: "Untitled.md", kind: "file" }];
  expect(uniqueChildName(entries, "notes", "Untitled.md")).toBe("Untitled.md");
  // …and a root create steps to " 1" while a notes/ create stays free.
  expect(uniqueChildName(entries, "", "Untitled.md")).toBe("Untitled 1.md");
});

test("uniqueChildName suffixes a folder (no extension) at the end of the name", () => {
  const entries: TreeEntry[] = [{ path: "New Folder", kind: "dir" }];
  expect(uniqueChildName(entries, "", "New Folder")).toBe("New Folder 1");
});

test("uniqueChildName treats a leading-dot name as all-stem (suffix at the end)", () => {
  const entries: TreeEntry[] = [{ path: ".env", kind: "file" }];
  expect(uniqueChildName(entries, "", ".env")).toBe(".env 1");
});

test("uniqueChildName preserves a multi-dot extension split (only the last segment is the ext)", () => {
  const entries: TreeEntry[] = [{ path: "Untitled.sheet", kind: "file" }];
  expect(uniqueChildName(entries, "", "Untitled.sheet")).toBe("Untitled 1.sheet");
});
