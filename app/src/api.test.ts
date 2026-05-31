// app/src/api.test.ts
import { test, expect } from "bun:test";
import { api } from "./api";
import type { Schema } from "../../core/src/schema/types";

test("api exposes a schema() method returning a Schema promise", () => {
  expect(typeof api.schema).toBe("function");
  // Type-level: the return is Promise<Schema>. Compile-time check, no network call.
  const _typed: () => Promise<Schema> = api.schema;
  expect(_typed).toBe(api.schema);
});
