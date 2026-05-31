// core/test/schema/integration.test.ts
import { test, expect } from "bun:test";
import { loadRegistry } from "../../src/schema/registry";
import { validateDocument } from "../../src/schema/validate";
import { parseList } from "../../src/schema/coerce";

test("acceptance: registry + document validation for a realistic frontmatter", () => {
  const schema = loadRegistry({
    rating: { type: "number", min: 0, max: 5 },
    status: { enum: ["draft", "published"] },
    tags: { list: "string" },
    due: "date",
    home: "file",
  });

  // rating: four (registered number) -> error squiggle
  const bad = validateDocument({ rating: "four" }, schema, { mode: "frontmatter" });
  const ratingDiag = bad.find((d) => d.path[0] === "rating")!;
  expect(ratingDiag.severity).toBe("error");
  expect(ratingDiag.message).toBe("expected a number");

  // status: typo -> enum error with nearest-match suggestion
  const enumDiags = validateDocument({ status: "publishd" }, schema, {
    mode: "frontmatter",
  });
  const statusDiag = enumDiags.find((d) => d.path[0] === "status")!;
  expect(statusDiag.suggestions).toContain("published");

  // unresolved file link -> warning
  const fileDiags = validateDocument({ home: "[[Missing]]" }, schema, {
    mode: "frontmatter",
    ctx: { resolveLink: () => false },
  });
  expect(fileDiags.find((d) => d.path[0] === "home")!.severity).toBe("warning");

  // a fully valid doc is clean
  const ok = validateDocument(
    { rating: 4, status: "draft", tags: "fiction, russian", due: "2026-06-01" },
    schema,
    { mode: "frontmatter", ctx: { resolveLink: () => true } },
  );
  expect(ok).toEqual([]);
});

test("acceptance: 'fiction, russian' parses to two tags and a multi-word tag is not split", () => {
  expect(parseList("fiction, russian")).toEqual(["fiction", "russian"]);
  expect(parseList("science fiction, russian")).toEqual(["science fiction", "russian"]);
});
