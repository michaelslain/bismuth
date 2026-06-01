// app/src/export/rowsHtml.test.ts
import { test, expect, describe } from "bun:test";
import { rowsToHtmlTable } from "./rowsHtml";
import type { Row } from "../../../core/src/bases/types";

const row = (name: string, note: Record<string, unknown>): Row =>
  ({ file: { name } as any, note, formula: {} });

describe("rowsToHtmlTable", () => {
  test("emits a table with header + rows", () => {
    const out = rowsToHtmlTable([row("Dune", { author: "Herbert" })]);
    expect(out).toContain("<table>");
    expect(out).toContain("<th>name</th><th>author</th>");
    expect(out).toContain("<td>Dune</td><td>Herbert</td>");
  });
  test("escapes html in cells", () => {
    const out = rowsToHtmlTable([row("<b>x</b>", {})]);
    expect(out).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td>");
  });
});
