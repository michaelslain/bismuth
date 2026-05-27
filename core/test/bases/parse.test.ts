import { test, expect } from "bun:test";
import { parseBase } from "../../src/bases/parse";

test("parses the canonical obsidian example", () => {
  const yaml = `
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
formulas:
  ppu: "(price / age).toFixed(2)"
properties:
  status:
    displayName: Status
views:
  - type: table
    name: My table
    limit: 10
    order:
      - file.name
      - formula.ppu
    summaries:
      formula.ppu: Average
`;
  const base = parseBase(yaml);
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
  expect(base.views[0].name).toBe("My table");
  expect(base.views[0].limit).toBe(10);
  expect(base.views[0].order).toEqual(["file.name", "formula.ppu"]);
  expect(base.formulas?.ppu).toBe("(price / age).toFixed(2)");
  expect(base.properties?.status?.displayName).toBe("Status");
  expect((base.filters as { or: unknown[] }).or).toHaveLength(2);
});

test("defaults a view name and type when missing", () => {
  const base = parseBase(`views:\n  - {}\n`);
  expect(base.views[0].type).toBe("table");
  expect(base.views[0].name).toBe("Untitled view");
});

test("synthesizes a default table view when views is absent", () => {
  const base = parseBase(`filters: 'file.hasTag(\"x\")'`);
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
});

test("normalizes groupBy given as a bare string", () => {
  const base = parseBase(`views:\n  - type: table\n    name: V\n    groupBy: note.status\n`);
  expect(base.views[0].groupBy).toEqual({ property: "note.status", direction: "ASC" });
});

test("returns a safe empty base on malformed yaml", () => {
  const base = parseBase(":\n::\n  - broken");
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
});
