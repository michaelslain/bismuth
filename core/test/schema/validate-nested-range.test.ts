// Regression: soft min/max range warnings must fire for NESTED object fields,
// not just top-level numbers. settings.yaml nests every tunable under a section
// (e.g. graph.repulsion), so without this nested-range warnings never appear.
import { test, expect } from "bun:test";
import { validateDocument } from "../../src/schema/validate";
import type { Schema } from "../../src/schema/types";

const schema: Schema = {
  graph: {
    type: {
      kind: "object",
      fields: {
        repulsion: { type: "number", min: -40, max: -1 },
        nodeSize: { type: "number", min: 2, max: 16 },
      },
    },
  },
};

test("nested numeric below min warns with the right path", () => {
  const diags = validateDocument({ graph: { repulsion: 5 } }, schema, { mode: "settings" });
  const d = diags.find((x) => x.path.join(".") === "graph.repulsion");
  expect(d).toBeTruthy();
  expect(d!.severity).toBe("warning");
  expect(d!.message).toContain("-1"); // expected a value <= -1
});

test("nested numeric in range produces no diagnostic", () => {
  const diags = validateDocument({ graph: { repulsion: -10, nodeSize: 6 } }, schema, { mode: "settings" });
  expect(diags.filter((x) => x.path[0] === "graph")).toEqual([]);
});

test("nested numeric above max warns", () => {
  const diags = validateDocument({ graph: { nodeSize: 99 } }, schema, { mode: "settings" });
  const d = diags.find((x) => x.path.join(".") === "graph.nodeSize");
  expect(d?.severity).toBe("warning");
  expect(d!.message).toContain("16");
});
