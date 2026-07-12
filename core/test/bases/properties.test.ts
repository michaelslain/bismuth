import { test, expect } from "bun:test";
import { declaredDefaults, declaredPropertyKeys } from "../../src/bases/properties";
import type { BaseConfig } from "../../src/bases/types";

const declared: BaseConfig = {
  properties: {
    status: { default: "Todo" },
    priority: { type: "number", default: 1 },
    done: { type: "checkbox", default: false },
    description: {},                       // declared, no default
    "note.effort": { default: "low" },     // namespaced spelling
    "formula.ppu": { default: 9 },         // non-writable namespace
  },
  declaredProperties: ["status", "priority", "done", "description", "note.effort", "formula.ppu"],
  views: [{ type: "kanban", name: "B" }],
};

test("declaredDefaults seeds every writable declared default under its bare key", () => {
  expect(declaredDefaults(declared)).toEqual({
    status: "Todo",
    priority: 1,
    done: false,          // falsey defaults are real defaults
    effort: "low",        // note. prefix stripped
    // description: no default → absent; formula.ppu: not writable → absent
  });
});

test("declaredDefaults respects the exclude set (matched on bare names)", () => {
  const out = declaredDefaults(declared, new Set(["status", "effort"]));
  expect(out).toEqual({ priority: 1, done: false });
});

test("declaredDefaults is empty for a map-form or property-less base", () => {
  expect(declaredDefaults({ properties: { a: { default: 1 } }, views: [] })).toEqual({});
  expect(declaredDefaults({ views: [] })).toEqual({});
});

test("declaredPropertyKeys returns bare names in declaration order, empty when undeclared", () => {
  expect(declaredPropertyKeys(declared)).toEqual(["status", "priority", "done", "description", "effort", "formula.ppu"]);
  expect(declaredPropertyKeys({ properties: { a: {} }, views: [] })).toEqual([]);
});
