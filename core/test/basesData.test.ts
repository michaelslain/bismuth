import { test, expect } from "bun:test";
import { buildVaultRows, patchVaultRows } from "../src/basesData";
import { createAsyncCache } from "../src/asyncCache";
import { getFileAccess, setFileAccess } from "../src/fileAccess";
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

// Creating a note used to drop the WHOLE feed, so the next /rows paid a full vault walk +
// re-parse of every note — the "a base I just created loads slowly" cost. The new note must
// now be spliced into its real position with the cached rows reused around it.
//
// listMarkdown is stubbed to put the new note in the MIDDLE of the walk order. On a real
// APFS vault a newly-created file happens to come back last, which would let a naive
// "append it to the end" implementation pass an order check by accident — this pins the
// insertion position so only real order-preserving insertion passes.
test("patchVaultRows: a brand-new note is inserted at its walk position, feed kept", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "body a");
  await writeNote(vault, "m.md", "body m");
  await writeNote(vault, "z.md", "body z");

  const real = await getFileAccess();
  let order = ["z.md", "m.md", "a.md"];
  setFileAccess({ ...real, listMarkdown: async () => order });
  try {
    const cache = await seededCache(vault);
    expect(cache.peek()!.map((r) => r.file.path)).toEqual(["z.md", "m.md", "a.md"]);

    await writeNote(vault, "fresh.md", "---\ntags: [new]\n---\nbrand new [[a]]");
    order = ["z.md", "fresh.md", "m.md", "a.md"]; // lands mid-list, NOT appended
    await patchVaultRows(vault, ["fresh.md"], cache);

    // The feed survives — no full rebuild is forced on the next read.
    expect(cache.peek()).not.toBeNull();
    const patched = cache.peek()!;
    expect(patched.map((r) => r.file.path)).toEqual(order); // append would give z,m,a,fresh
    const fresh = patched.find((r) => r.file.path === "fresh.md")!;
    expect(fresh.file.tags).toEqual(["new"]);
    expect(fresh.file.links).toEqual(["a"]);
    expect(norm(patched)).toBe(norm(await buildVaultRows(vault)));
  } finally {
    setFileAccess(real);
  }
});

// Safety valve: if the vault holds a note the cached feed never saw (a missed watcher
// event), patching would silently serve an incomplete feed — so it must rebuild instead.
test("patchVaultRows: an unseen note on disk forces a full rebuild", async () => {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-patch-"));
  await writeNote(vault, "a.md", "body a");
  const cache = await seededCache(vault);

  await writeNote(vault, "unseen.md", "never announced"); // no event for this one
  await writeNote(vault, "fresh.md", "announced");
  await patchVaultRows(vault, ["fresh.md"], cache);

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
