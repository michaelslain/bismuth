import { test, expect } from "bun:test";
import {
  blankPropertyRow,
  nextPropertyName,
  parsePropertyOptions,
  seedPropertyRows,
  moveRow,
  buildPropertiesYaml,
  type PropertyFormRow,
} from "./basePropertiesForm";
import type { BaseConfig } from "../../../core/src/bases/types";

const row = (over: Partial<PropertyFormRow> = {}): PropertyFormRow => ({
  name: "priority",
  kind: "text",
  hidden: false,
  optionsText: "",
  number: "plain",
  unit: "",
  expr: "",
  defaultText: "",
  ...over,
});

test("nextPropertyName: first is 'property', then increments, case-insensitive", () => {
  expect(nextPropertyName([])).toBe("property");
  expect(nextPropertyName(["Property"])).toBe("property 2");
  expect(nextPropertyName(["property", "property 2"])).toBe("property 3");
});

test("blankPropertyRow seeds a unique name + text-kind defaults", () => {
  const r = blankPropertyRow(["property"]);
  expect(r.name).toBe("property 2");
  expect(r.kind).toBe("text");
  expect(r.hidden).toBe(false);
});

test("parsePropertyOptions: comma, newline, and mixed, trims + dedupes, drops empties", () => {
  expect(parsePropertyOptions("todo, doing, done")).toEqual(["todo", "doing", "done"]);
  expect(parsePropertyOptions("todo\ndoing\ndone")).toEqual(["todo", "doing", "done"]);
  expect(parsePropertyOptions(" todo ,,\n doing \ntodo")).toEqual(["todo", "doing"]);
  expect(parsePropertyOptions("")).toEqual([]);
});

test("seedPropertyRows: empty when base has no declared list-form properties", () => {
  expect(seedPropertyRows({ views: [] } as unknown as BaseConfig)).toEqual([]);
  // Map-form properties (no declaredProperties) — deliberately not surfaced.
  const mapForm: BaseConfig = { views: [], properties: { status: { hidden: true } } };
  expect(seedPropertyRows(mapForm)).toEqual([]);
});

test("seedPropertyRows: reads declared list-form properties in order, with type carriers", () => {
  const config: BaseConfig = {
    views: [],
    declaredProperties: ["status", "price"],
    properties: {
      status: { type: { kind: "select", options: ["todo", "done"] }, hidden: true },
      price: { type: { kind: "number", number: "currency", unit: "USD" }, default: 9.99 },
    },
  };
  const rows = seedPropertyRows(config);
  expect(rows.length).toBe(2);
  expect(rows[0]).toMatchObject({ name: "status", kind: "select", hidden: true, optionsText: "todo\ndone" });
  expect(rows[1]).toMatchObject({ name: "price", kind: "number", number: "currency", unit: "USD", defaultText: "9.99" });
});

test("moveRow: swaps with the neighbor in the given direction, no-op past either end", () => {
  expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(moveRow(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  expect(moveRow(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moveRow(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
});

test("buildPropertiesYaml: drops blank-named rows, keeps first of a duplicate name", () => {
  const rows = [row({ name: "" }), row({ name: "status" }), row({ name: "status", kind: "number" })];
  const out = buildPropertiesYaml(rows);
  expect(out).toEqual([{ name: "status", type: "text" }]);
});

test("buildPropertiesYaml: select/multiselect emit options only when non-empty", () => {
  const out = buildPropertiesYaml([
    row({ name: "stage", kind: "select", optionsText: "todo, doing, done" }),
    row({ name: "tags", kind: "multiselect", optionsText: "" }),
  ]);
  expect(out).toEqual([
    { name: "stage", type: "select", options: ["todo", "doing", "done"] },
    { name: "tags", type: "multiselect" },
  ]);
});

test("buildPropertiesYaml: number emits format + unit, coerces default to a number", () => {
  const out = buildPropertiesYaml([
    row({ name: "price", kind: "number", number: "currency", unit: "usd", defaultText: "9.99" }),
  ]);
  expect(out).toEqual([{ name: "price", type: "number", number: "currency", unit: "usd", default: 9.99 }]);
});

test("buildPropertiesYaml: formula emits expr and never a default", () => {
  const out = buildPropertiesYaml([
    row({ name: "total", kind: "formula", expr: "note.qty * note.price", defaultText: "should be ignored" }),
  ]);
  expect(out).toEqual([{ name: "total", type: "formula", expr: "note.qty * note.price" }]);
});

test("buildPropertiesYaml: hidden + boolean default coercion", () => {
  const out = buildPropertiesYaml([row({ name: "done", kind: "boolean", hidden: true, defaultText: "false" })]);
  expect(out).toEqual([{ name: "done", type: "boolean", hidden: true, default: false }]);
});
