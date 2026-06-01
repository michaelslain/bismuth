import { test, expect, describe } from "bun:test";
import { isValidRegex } from "./searchOpts";

describe("isValidRegex", () => {
  test("true for a valid pattern", () => {
    expect(isValidRegex("[a-z]+")).toBe(true);
  });
  test("false for an invalid pattern", () => {
    expect(isValidRegex("(")).toBe(false);
  });
});
