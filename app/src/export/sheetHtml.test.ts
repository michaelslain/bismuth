// app/src/export/sheetHtml.test.ts
import { test, expect, describe } from "bun:test";
import { snapshotToHtmlTable } from "./sheetHtml";

describe("snapshotToHtmlTable", () => {
  test("renders cells into a grid", () => {
    const snap = {
      sheetOrder: ["s1"],
      sheets: {
        s1: { name: "Sheet1", cellData: { 0: { 0: { v: "A1" }, 1: { v: "B1" } }, 1: { 0: { v: 2 } } } },
      },
    };
    const out = snapshotToHtmlTable(snap);
    expect(out).toContain("<table>");
    expect(out).toContain("<td>A1</td>");
    expect(out).toContain("<td>B1</td>");
    expect(out).toContain("<td>2</td>");
    expect(out).toContain("<td></td>");
  });
  test("empty workbook -> empty table", () => {
    expect(snapshotToHtmlTable({})).toContain("<table>");
  });
});
