import { test, expect } from "bun:test";
import { parseSnapshot, serializeSnapshot, SheetParseError } from "./snapshot";

test("empty string parses to a blank workbook ({})", () => {
  expect(parseSnapshot("")).toEqual({});
});

test("whitespace-only parses to a blank workbook ({})", () => {
  expect(parseSnapshot("   \n  ")).toEqual({});
});

test("valid JSON parses to the object", () => {
  expect(parseSnapshot('{"id":"wb1","name":"Sheet"}')).toEqual({ id: "wb1", name: "Sheet" });
});

test("invalid JSON throws SheetParseError", () => {
  expect(() => parseSnapshot("{not json")).toThrow(SheetParseError);
});

test("serialize then parse round-trips", () => {
  const data = { id: "wb1", sheets: { s1: { name: "A" } } };
  expect(parseSnapshot(serializeSnapshot(data))).toEqual(data);
});

test("serialize is stable/deterministic for the same input", () => {
  const data = { id: "wb1", name: "S" };
  expect(serializeSnapshot(data)).toBe(serializeSnapshot(data));
});
