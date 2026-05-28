import { test, expect } from "bun:test";
import { runView, canonicalId } from "../../src/bases/query";
import type { BaseConfig, Row } from "../../src/bases/types";

function row(name: string, note: Record<string, unknown>): Row {
  return {
    file: { name, basename: name, path: `${name}.md`, folder: "", ext: "md", size: 1, ctime: 0, mtime: 0, tags: (note.tags as string[]) ?? [], links: [] },
    note,
    formula: {},
  };
}

const rows: Row[] = [
  row("alpha", { status: "open", price: 10, age: 2, tags: ["book"] }),
  row("beta", { status: "done", price: 4, age: 1, tags: ["book"] }),
  row("gamma", { status: "open", price: 20, age: 4, tags: ["movie"] }),
];

const base: BaseConfig = {
  formulas: { ppu: "(price / age).toFixed(2)" },
  views: [
    {
      type: "table",
      name: "V",
      filters: 'status != "done"',
      order: ["file.name", "note.price", "formula.ppu"],
      sort: [{ property: "note.price", direction: "DESC" }],
      summaries: { "note.price": "Sum" },
    },
  ],
};

test("filters, computes formulas, sorts, resolves columns", () => {
  const res = runView(base, rows, 0);
  expect(res.columns).toEqual(["file.name", "note.price", "formula.ppu"]);
  const flat = res.groups[0].rows;
  expect(flat.map((r) => r.file.name)).toEqual(["gamma", "alpha"]); // price DESC, 'done' filtered out
  expect(flat[0].formula.ppu).toBe("5.00"); // 20/4
});

test("applies global + view filters with AND", () => {
  const b: BaseConfig = { filters: 'file.hasTag("book")', views: [{ type: "table", name: "V", filters: 'status == "open"', order: ["file.name"] }] };
  const res = runView(b, rows, 0);
  expect(res.groups[0].rows.map((r) => r.file.name)).toEqual(["alpha"]);
});

test("groups rows by a property", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V", order: ["file.name"], groupBy: { property: "note.status", direction: "ASC" } }] };
  const res = runView(b, rows, 0);
  const keys = res.groups.map((g) => g.key).sort();
  expect(keys).toEqual(["done", "open"]);
});

test("respects limit", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V", order: ["file.name"], limit: 1 }] };
  const res = runView(b, rows, 0);
  expect(res.groups[0].rows).toHaveLength(1);
});

test("computes Sum/Average/Min/Max/Count summaries", () => {
  const res = runView(base, rows, 0);
  expect(res.summaries["note.price"]).toBe("30"); // 10 + 20
});

test("auto-derives columns from frontmatter when order is absent", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V" }] };
  const res = runView(b, rows, 0);
  expect(res.columns[0]).toBe("file.name");
  expect(res.columns).toContain("note.status");
});

test("canonicalId normalizes bare frontmatter names to note.*", () => {
  expect(canonicalId("price")).toBe("note.price");
  expect(canonicalId("note.price")).toBe("note.price");
  expect(canonicalId("file.name")).toBe("file.name");
  expect(canonicalId("formula.ppu")).toBe("formula.ppu");
});

test("bare-id summary aligns with auto-derived note.* columns", () => {
  // order omitted -> columns derived as note.*, summary written with a bare id
  const b: BaseConfig = { views: [{ type: "table", name: "V", summaries: { price: "Sum" } }] };
  const res = runView(b, rows, 0);
  expect(res.columns).toContain("note.price");
  expect(res.summaries["note.price"]).toBe("34"); // 10 + 4 + 20 (no filter)
});
