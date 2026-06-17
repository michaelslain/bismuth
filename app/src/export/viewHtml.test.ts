// app/src/export/viewHtml.test.ts
import { test, expect, describe } from "bun:test";
import { cardsHtml, kanbanHtml, listHtml } from "./viewHtml";
import { paletteFor } from "./exportTheme";
import type { BaseConfig, Row, ViewConfig, ViewResult } from "../../../core/src/bases/types";

const cfg: BaseConfig = { views: [] };
const DARK = paletteFor("dark");

function row(name: string, note: Record<string, unknown>): Row {
  return { file: { name, basename: name, path: `${name}.md`, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] }, note, formula: {} };
}

function vr(columns: string[], groups: { key: string; rows: Row[] }[], view: Partial<ViewConfig> = {}): ViewResult {
  return { view: { type: "cards", name: "V", ...view }, columns, groups, summaries: {} };
}

describe("cardsHtml", () => {
  test("renders a card per row with title + fields", () => {
    const result = vr(["file.name", "author"], [{ key: "", rows: [row("Dune", { author: "Herbert" })] }]);
    const { body, css } = cardsHtml(cfg, result, DARK);
    expect(body).toContain("exp-cardgrid");
    expect(body).toContain("Dune");          // title (first column)
    expect(body).toContain("Herbert");        // field value
    expect(body).toContain("author");         // field label
    expect(css).toContain(".exp-card");
  });

  test("emits a group header for grouped results", () => {
    const result = vr(["file.name"], [{ key: "Reading", rows: [row("Dune", {})] }]);
    expect(cardsHtml(cfg, result, DARK).body).toContain(">Reading<");
  });
});

describe("kanbanHtml", () => {
  test("a column per group, with count + hidden order column", () => {
    const result = vr(
      ["file.name", "note.order"],
      [
        { key: "To Read", rows: [row("A", { order: 0 }), row("B", { order: 1 })] },
        { key: "Done", rows: [row("C", { order: 0 })] },
      ],
      { groupBy: { property: "note.status" } },
    );
    const { body } = kanbanHtml(cfg, result, DARK);
    expect((body.match(/exp-kbcol/g) ?? []).length).toBe(2);
    expect(body).toContain("To Read");
    expect(body).toContain("Done");
    expect(body).toContain("exp-kbcount");
    // the persistence-only order column is hidden (not listed in view.order)
    expect(body).not.toContain(">order<");
  });
});

describe("listHtml", () => {
  test("one list item per row with title + meta", () => {
    const result = vr(["file.name", "author"], [{ key: "", rows: [row("Dune", { author: "Herbert" })] }], { type: "list" });
    const { body } = listHtml(cfg, result, DARK);
    expect(body).toContain("exp-listitem");
    expect(body).toContain("Dune");
    expect(body).toContain("Herbert");
  });
});
