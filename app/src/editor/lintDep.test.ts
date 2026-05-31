// app/src/editor/lintDep.test.ts
import { test, expect } from "bun:test";

test("@codemirror/lint is resolvable (linter + setDiagnostics exported)", async () => {
  const lint = await import("@codemirror/lint");
  expect(typeof lint.linter).toBe("function");
  expect(typeof lint.setDiagnostics).toBe("function");
});
