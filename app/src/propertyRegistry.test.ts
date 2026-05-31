// app/src/propertyRegistry.test.ts
import { test, expect } from "bun:test";
import { propertyRegistry } from "./propertyRegistry";

test("propertyRegistry accessor exists and returns an object before hydration", () => {
  // Before any fetch resolves, the accessor returns the empty seed Schema ({}),
  // never undefined — so callers (autocomplete/lint) can deref safely on first paint.
  expect(typeof propertyRegistry).toBe("function");
  expect(propertyRegistry()).toEqual({});
});
