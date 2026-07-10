import { test, expect } from "bun:test";
import { buildVaultRows, patchVaultRows } from "../src/basesData";
import { createAsyncCache } from "../src/asyncCache";
import { writeNote } from "../src/files";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("buildVaultRows returns a row per note with file meta + frontmatter", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-rows-"));
  await writeNote(vault, "housing.md", "---\nstatus: open\ntags: [logistics]\nprice: 10\n---\n# Housing\n[[internship]] #urgent");
  await writeNote(vault, "reading/book.md", "---\ntitle: A Book\n---\nbody");

  const rows = await buildVaultRows(vault);
  const housing = rows.find((r) => r.file.name === "housing")!;
  expect(housing.file.path).toBe("housing.md");
  expect(housing.file.folder).toBe("");
  expect(housing.file.tags.sort()).toEqual(["logistics", "urgent"]);
  expect(housing.file.links).toEqual(["internship"]);
  expect(housing.note.status).toBe("open");
  expect(housing.note.price).toBe(10);

  const book = rows.find((r) => r.file.name === "book")!;
  expect(book.file.folder).toBe("reading");
  expect(book.note.title).toBe("A Book");
});

// The incremental feed patch must yield a Row[] byte-identical to a full rebuild, so a base
// render after an edit is fast (patch a few notes) yet never shows stale/wrong rows.
async function seededCache(vault: string) {
  const cache = createAsyncCache(() => buildVaultRows(vault));
  await cache.get();
  return cache;
}
const norm = (rows: any[]) => JSON.stringify([...rows].sort((a, b) => a.file.path.localeCompare(b.file.path)));

test("patchVaultRows: an edited note is replaced in place, identical to a rebuild", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "---\ntags: [x]\n---\nlinks [[b]] #one");
  await writeNote(vault, "b.md", "---\ntitle: B\n---\nplain body");
  const cache = await seededCache(vault);

  await writeNote(vault, "a.md", "---\ntags: [x, y]\nrating: 5\n---\nnow [[b]] #one #two");
  await patchVaultRows(vault, ["a.md"], cache);

  expect(norm(cache.peek()!)).toBe(norm(await buildVaultRows(vault)));
  const a = cache.peek()!.find((r) => r.file.name === "a")!;
  expect(a.file.tags.sort()).toEqual(["one", "two", "x", "y"]);
  expect(a.note.rating).toBe(5);
});

test("patchVaultRows: a deleted note is spliced out, identical to a rebuild", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "body a");
  await writeNote(vault, "gone.md", "body gone");
  const cache = await seededCache(vault);

  rmSync(join(vault, "gone.md"));
  await patchVaultRows(vault, ["gone.md"], cache);

  expect(cache.peek()!.some((r) => r.file.path === "gone.md")).toBe(false);
  expect(norm(cache.peek()!)).toBe(norm(await buildVaultRows(vault)));
});

test("patchVaultRows: a brand-new note falls back to a full rebuild (order-safe)", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "body a");
  const cache = await seededCache(vault);

  await writeNote(vault, "fresh.md", "---\ntags: [new]\n---\nbrand new [[a]]");
  await patchVaultRows(vault, ["fresh.md"], cache);

  // New note can't be inserted order-preservingly → cache dropped, next read rebuilds fresh.
  expect(cache.peek()).toBeNull();
  expect(norm(await cache.get())).toBe(norm(await buildVaultRows(vault)));
});

test("patchVaultRows: empty cache and non-md paths are safe no-ops", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "body a");
  const cache = await seededCache(vault);

  // Non-.md changes never touch the notes feed → same array reference, untouched.
  const before = cache.peek();
  await patchVaultRows(vault, ["a.png", "assets/"], cache);
  expect(cache.peek()).toBe(before);

  // Patching an empty cache must not throw and leaves it empty (next read rebuilds).
  cache.invalidate();
  await patchVaultRows(vault, ["a.md"], cache);
  expect(cache.peek()).toBeNull();
});
