// app/src/export/csvTable.test.ts
import { test, expect, describe } from "bun:test";
import { tableToCsv } from "./csvTable";

describe("tableToCsv", () => {
  test("plain cells join with commas + CRLF rows", () => {
    const csv = tableToCsv({ columns: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  test("quotes fields containing comma/quote/newline (RFC-4180)", () => {
    const csv = tableToCsv({ columns: ["x"], rows: [["a,b"], ['he said "hi"'], ["line1\nline2"]] });
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  test("falls back to a name column when no columns", () => {
    expect(tableToCsv({ columns: [], rows: [] })).toBe("name\r\n");
  });
});
