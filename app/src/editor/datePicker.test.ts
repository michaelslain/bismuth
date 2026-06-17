// app/src/editor/datePicker.test.ts
import { test, expect, describe } from "bun:test";
import {
  findDateTarget,
  parseDateValue,
  composeDateValue,
  dateKindOf,
} from "./datePickerCore";
import type { Schema } from "../../../core/src/schema/types";

const SCHEMA: Schema = {
  due: { type: "date" },
  when: { type: "datetime" },
  title: { type: "string" },
  tags: { type: { kind: "list", item: "string" } },
};

describe("dateKindOf", () => {
  test("maps date / datetime types, ignores others + unknowns", () => {
    expect(dateKindOf(SCHEMA, "due")).toBe("date");
    expect(dateKindOf(SCHEMA, "when")).toBe("datetime");
    expect(dateKindOf(SCHEMA, "title")).toBeNull();
    expect(dateKindOf(SCHEMA, "tags")).toBeNull();
    expect(dateKindOf(SCHEMA, "missing")).toBeNull();
  });
});

describe("findDateTarget", () => {
  // Helper: build a doc and return the offset of a `|` caret marker (stripped from the doc).
  function at(docWithCaret: string): { doc: string; head: number } {
    const head = docWithCaret.indexOf("|");
    return { doc: docWithCaret.replace("|", ""), head };
  }

  test("empty date value: caret just after the colon+space", () => {
    const { doc, head } = at("---\ndue: |\n---\n# body\n");
    const t = findDateTarget(doc, head, SCHEMA);
    expect(t).not.toBeNull();
    expect(t!.kind).toBe("date");
    expect(t!.key).toBe("due");
    expect(t!.current).toBe("");
    // valueFrom points at the (empty) value position, == caret here
    expect(doc.slice(t!.valueFrom, t!.valueTo)).toBe("");
    expect(t!.valueFrom).toBe(head);
  });

  test("existing date value: range covers the value, trailing spaces trimmed", () => {
    const { doc, head } = at("---\ndue: 2026-06-16|   \n---\n");
    const t = findDateTarget(doc, head, SCHEMA);
    expect(t).not.toBeNull();
    expect(t!.current).toBe("2026-06-16");
    expect(doc.slice(t!.valueFrom, t!.valueTo)).toBe("2026-06-16");
  });

  test("datetime property reports the datetime kind", () => {
    const { doc, head } = at("---\nwhen: 2026-06-16T09:30|\n---\n");
    const t = findDateTarget(doc, head, SCHEMA);
    expect(t!.kind).toBe("datetime");
    expect(t!.current).toBe("2026-06-16T09:30");
  });

  test("caret in trailing whitespace past the value → null (outside the value region)", () => {
    const { doc, head } = at("---\ndue: 2026-06-16  |\n---\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("caret at the very end of a filled value → still inside the value", () => {
    const { doc, head } = at("---\ndue: 2026-06-16|\n---\n");
    const t = findDateTarget(doc, head, SCHEMA);
    expect(t).not.toBeNull();
    expect(t!.current).toBe("2026-06-16");
  });

  test("caret on the KEY (before the colon) → null", () => {
    const { doc, head } = at("---\ndu|e: 2026-06-16\n---\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("non-date property → null", () => {
    const { doc, head } = at("---\ntitle: hel|lo\n---\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("caret in the body (outside frontmatter) → null", () => {
    const { doc, head } = at("---\ndue: 2026-06-16\n---\nbody due: x|\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("indented line (list item) is never a top-level date property", () => {
    const { doc, head } = at("---\ndue:\n  - 2026-06-16|\n---\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("no frontmatter at all → null", () => {
    const { doc, head } = at("# just a note\ndue: 2026-06-16|\n");
    expect(findDateTarget(doc, head, SCHEMA)).toBeNull();
  });

  test("sig is stable across value edits on the same line", () => {
    const a = at("---\ndue: 2026-06-16|\n---\n");
    const b = at("---\ndue: 2026-12-3|\n---\n");
    const ta = findDateTarget(a.doc, a.head, SCHEMA)!;
    const tb = findDateTarget(b.doc, b.head, SCHEMA)!;
    expect(ta.sig).toBe(tb.sig);
  });
});

describe("parseDateValue", () => {
  test("date only", () => {
    expect(parseDateValue("2026-06-16")).toEqual({ date: "2026-06-16", time: "" });
  });
  test("datetime with T separator", () => {
    expect(parseDateValue("2026-06-16T14:30")).toEqual({ date: "2026-06-16", time: "14:30" });
  });
  test("datetime with space separator", () => {
    expect(parseDateValue("2026-06-16 09:05")).toEqual({ date: "2026-06-16", time: "09:05" });
  });
  test("strips surrounding quotes", () => {
    expect(parseDateValue('"2026-06-16"')).toEqual({ date: "2026-06-16", time: "" });
  });
  test("empty / non-date → empty parts", () => {
    expect(parseDateValue("")).toEqual({ date: "", time: "" });
    expect(parseDateValue("not a date")).toEqual({ date: "", time: "" });
  });
});

describe("composeDateValue", () => {
  test("date kind → bare date (time ignored)", () => {
    expect(composeDateValue("date", "2026-06-16", "14:30")).toBe("2026-06-16");
  });
  test("datetime kind with a time → joined with T", () => {
    expect(composeDateValue("datetime", "2026-06-16", "14:30")).toBe("2026-06-16T14:30");
  });
  test("datetime kind without a time → bare date", () => {
    expect(composeDateValue("datetime", "2026-06-16", "")).toBe("2026-06-16");
  });
  test("empty date → empty string", () => {
    expect(composeDateValue("date", "", "")).toBe("");
  });
});
