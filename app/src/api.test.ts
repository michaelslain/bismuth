// app/src/api.test.ts
import { test, expect, describe } from "bun:test";
import { api, resolveBase } from "./api";
import type { Schema } from "../../core/src/schema/types";

test("api exposes a schema() method returning a Schema promise", () => {
  expect(typeof api.schema).toBe("function");
  // Type-level: the return is Promise<Schema>. Compile-time check, no network call.
  const _typed: () => Promise<Schema> = api.schema;
  expect(_typed).toBe(api.schema);
});

describe("resolveBase (runtime backend selection for ?api= windows)", () => {
  test("?api= wins over the build env", () => {
    expect(resolveBase("?api=http://localhost:5000", "http://env:9")).toBe("http://localhost:5000");
  });
  test("trims one or many trailing slashes from ?api=", () => {
    expect(resolveBase("?api=http://localhost:5000/", undefined)).toBe("http://localhost:5000");
    expect(resolveBase("?api=http://localhost:5000///", undefined)).toBe("http://localhost:5000");
  });
  test("falls back to the build env when no ?api=", () => {
    expect(resolveBase("?foo=bar", "http://env:9")).toBe("http://env:9");
    expect(resolveBase("", "http://env:9")).toBe("http://env:9");
  });
  test("falls back to the default port when neither is set", () => {
    expect(resolveBase(undefined, undefined)).toBe("http://localhost:4321");
    expect(resolveBase("", undefined)).toBe("http://localhost:4321");
  });
  test("an empty ?api= value is ignored (treated as unset)", () => {
    expect(resolveBase("?api=", "http://env:9")).toBe("http://env:9");
  });
  test("two windows with different ?api= resolve to different backends", () => {
    expect(resolveBase("?api=http://localhost:4323", undefined)).not.toBe(
      resolveBase("?api=http://localhost:4324", undefined),
    );
  });
});
