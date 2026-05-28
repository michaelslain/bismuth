import { test, expect } from "bun:test";
import { buildVaultRows } from "../src/basesData";
import { writeNote } from "../src/files";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("buildVaultRows returns a row per note with file meta + frontmatter", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-rows-"));
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
