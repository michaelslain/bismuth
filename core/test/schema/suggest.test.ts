// core/test/schema/suggest.test.ts
import { test, expect } from "bun:test";
import { keySuggestions, valueSuggestions } from "../../src/schema/suggest";
import type { Schema, PropertyType } from "../../src/schema/types";

const schema: Schema = {
  title: { type: "string" },
  status: { type: { kind: "enum", values: ["draft", "published"] } },
  due: { type: "date" },
};

test("keySuggestions returns all keys for an empty prefix, sorted", () => {
  expect(keySuggestions(schema, "")).toEqual(["due", "status", "title"]);
});

test("keySuggestions filters by prefix case-insensitively", () => {
  expect(keySuggestions(schema, "ST")).toEqual(["status"]);
});

test("keySuggestions returns [] when nothing matches", () => {
  expect(keySuggestions(schema, "zzz")).toEqual([]);
});

test("valueSuggestions returns enum values filtered by prefix (case-insensitive)", () => {
  const t: PropertyType = { kind: "enum", values: ["draft", "published", "PreFlight"] };
  expect(valueSuggestions(t, "p")).toEqual(["published", "PreFlight"]);
});

test("valueSuggestions returns all enum values for an empty prefix", () => {
  const t: PropertyType = { kind: "enum", values: ["a", "b"] };
  expect(valueSuggestions(t, "")).toEqual(["a", "b"]);
});

test("valueSuggestions drills into a list item enum type", () => {
  const t: PropertyType = { kind: "list", item: { kind: "enum", values: ["red", "green"] } };
  expect(valueSuggestions(t, "g")).toEqual(["green"]);
});

test("valueSuggestions for boolean offers true/false", () => {
  expect(valueSuggestions("boolean", "")).toEqual(["true", "false"]);
  expect(valueSuggestions("boolean", "t")).toEqual(["true"]);
});

test("valueSuggestions for a non-enumerable scalar returns []", () => {
  expect(valueSuggestions("string", "x")).toEqual([]);
});

test("valueSuggestions for the icon type returns [] (frontend supplies icon names)", () => {
  expect(valueSuggestions("icon", "")).toEqual([]);
  expect(valueSuggestions("icon", "Ho")).toEqual([]);
});
