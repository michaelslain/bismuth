// app/src/export/baseTable.test.ts
import { test, expect, describe } from "bun:test";
import { baseToTable, viewResultToTable, cellText } from "./baseTable";
import { parseBase } from "../../../core/src/bases/parse";
import { runView } from "../../../core/src/bases/query";
import type { ExportDeps } from "./types";
import type { Row } from "../../../core/src/bases/types";

function row(name: string, folder: string, note: Record<string, unknown>): Row {
  return {
    file: { name, basename: name, path: `${folder}/${name}.md`, folder, ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] },
    note,
    formula: {},
  };
}

function deps(read: string, rows: Row[]): ExportDeps {
  return {
    read: async () => read,
    resolveRows: async () => rows,
    htmlToPdf: async () => new Uint8Array(),
    htmlToPdfPages: async () => [],
    htmlToPng: async () => ({ bytes: new Uint8Array(), dataUrl: "" }),
    drawingToPng: async () => ({ bytes: new Uint8Array(), dataUrl: "" }),
    katexCss: async () => "",
  };
}

// The core regression: a filters-style base (filters: + views:, NO source:) must
// resolve to all notes and let runView apply the filters — the path that was broken
// when export used a { kind:"base", ref } spec and got zero rows.
describe("baseToTable — filters-style base", () => {
  const BASE = `---
type: base
filters:
  and:
    - file.inFolder("reading/books")
    - status == "finished"
views:
  - type: table
    order:
      - file.name
      - status
---
`;

  test("exports only the rows matching the base filters, with the view's columns", async () => {
    const rows = [
      row("Dune", "reading/books", { status: "finished" }),       // matches
      row("Hyperion", "reading/books", { status: "reading" }),    // dropped: status
      row("Journal", "notes", { status: "finished" }),            // dropped: folder
    ];
    const t = await baseToTable("reading/finished.md", deps(BASE, rows));
    expect(t.columns).toEqual(["name", "status"]);
    expect(t.rows).toEqual([["Dune", "finished"]]);
  });

  test("an unfiltered notes-default base passes rows through", async () => {
    const t = await baseToTable("x.md", deps("---\ntype: base\nviews:\n  - type: table\n    order: [file.name]\n---\n", [
      row("A", "f", {}),
      row("B", "f", {}),
    ]));
    expect(t.columns).toEqual(["name"]);
    expect(t.rows).toEqual([["A"], ["B"]]);
  });
});

describe("viewResultToTable column labels", () => {
  test("strips file./note./this. prefixes, formula. prefix, honors displayName", () => {
    const config = parseBase("properties:\n  author:\n    displayName: Writer\nviews:\n  - type: table\n    order: [file.name, note.year, formula.score, author]\nformulas:\n  score: 1\n");
    const r = { file: { name: "X", basename: "X", path: "X.md", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] }, note: { year: 2020, author: "H" }, formula: {} } as Row;
    const vr = runView(config, [r], 0);
    const t = viewResultToTable(config, vr);
    expect(t.columns).toEqual(["name", "year", "score", "Writer"]);
  });
});

describe("cellText", () => {
  test("formats null/array/date/scalar like the on-screen renderer", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(["a", "b"])).toBe("a, b");
    expect(cellText(new Date("2024-03-09T12:00:00Z"))).toBe("2024-03-09");
    expect(cellText(42)).toBe("42");
  });
});
