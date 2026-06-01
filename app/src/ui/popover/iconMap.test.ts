import { test, expect } from "bun:test";
import { completionIcon } from "./iconMap";

test("maps known CodeMirror completion types to Lucide names", () => {
  expect(completionIcon("enum")).toBe("List");
  expect(completionIcon("property")).toBe("Tag");
  expect(completionIcon("keyword")).toBe("Hash");
});

test("falls back to a neutral icon for unknown or missing type", () => {
  expect(completionIcon(undefined)).toBe("ChevronRight");
  expect(completionIcon("totally-unknown")).toBe("ChevronRight");
});
