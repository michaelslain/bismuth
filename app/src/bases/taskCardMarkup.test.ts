import { test, expect } from "bun:test";
import { buildTaskCardParts, isResolvedStatus } from "./taskCardMarkup";

// Pull the data-line / data-status off every rendered marker, in document order.
function markers(html: string): Array<{ line: number; status: string }> {
  return [...html.matchAll(/<span class="oa-task-box" data-status="([^"]*)" data-line="(\d+)">/g)].map(
    (m) => ({ status: m[1], line: Number(m[2]) }),
  );
}

test("isResolvedStatus: done + cancelled are resolved; todo + in-progress are active", () => {
  expect(isResolvedStatus("x")).toBe(true);
  expect(isResolvedStatus("X")).toBe(true);
  expect(isResolvedStatus("-")).toBe(true);
  expect(isResolvedStatus(" ")).toBe(false);
  expect(isResolvedStatus("/")).toBe(false);
});

test("every task status renders exactly one marker with the right status char", () => {
  const body = ["- [ ] a", "- [/] b", "- [x] c", "- [-] d"].join("\n");
  const { openHtml, doneHtml } = buildTaskCardParts(body);
  // todo + in-progress stay open; done + cancelled collapse.
  expect(markers(openHtml)).toEqual([
    { status: " ", line: 0 },
    { status: "/", line: 1 },
  ]);
  expect(markers(doneHtml)).toEqual([
    { status: "x", line: 2 },
    { status: "-", line: 3 },
  ]);
});

test("data-line is the ABSOLUTE source line, counting past frontmatter", () => {
  const body = ["---", "type: note", "---", "", "- [ ] first", "- [x] second"].join("\n");
  const { openHtml, doneHtml } = buildTaskCardParts(body);
  expect(markers(openHtml)).toEqual([{ status: " ", line: 4 }]);
  expect(markers(doneHtml)).toEqual([{ status: "x", line: 5 }]);
});

test("mixed statuses keep correct lines (the bug positional indexing hit)", () => {
  // `[/]` and `[-]` don't render a native checkbox, so positional checkbox→line mapping
  // would skip them and misalign the rest. Marker-per-line keeps every line correct.
  const body = ["- [x] done one", "- [-] cancelled", "- [x] done two"].join("\n");
  const { doneHtml } = buildTaskCardParts(body);
  expect(markers(doneHtml)).toEqual([
    { status: "x", line: 0 },
    { status: "-", line: 1 },
    { status: "x", line: 2 },
  ]);
});

test("tasks mode keeps only checklist lines but preserves their absolute lines", () => {
  const body = ["# Heading", "some prose", "- [ ] todo", "more prose", "- [x] done"].join("\n");
  const { openHtml, doneHtml } = buildTaskCardParts(body, "tasks");
  expect(openHtml).not.toContain("Heading");
  expect(openHtml).not.toContain("some prose");
  expect(markers(openHtml)).toEqual([{ status: " ", line: 2 }]);
  expect(markers(doneHtml)).toEqual([{ status: "x", line: 4 }]);
});

test("doneCount counts resolved tasks only", () => {
  const body = ["- [ ] a", "- [/] b", "- [x] c", "- [-] d"].join("\n");
  expect(buildTaskCardParts(body).doneCount).toBe(2);
});

test("task body (links/text) survives alongside the marker", () => {
  const { openHtml } = buildTaskCardParts("- [ ] buy [[Milk]] today");
  expect(openHtml).toContain('data-status=" "');
  expect(openHtml).toContain("today");
  expect(openHtml).toContain("Milk"); // wikilink still rendered
});
