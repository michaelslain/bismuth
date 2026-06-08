import { describe, expect, test } from "bun:test";
import { normalizeFrontmatterSpacing, minimalChange } from "./normalizeFrontmatter";

/** Apply a {from,to,insert} change to a string — mirrors what CodeMirror's dispatch does. */
const apply = (s: string, c: { from: number; to: number; insert: string }) =>
  s.slice(0, c.from) + c.insert + s.slice(c.to);

describe("minimalChange", () => {
  test("returns an insertion of just the blank line (squished → spaced)", () => {
    const a = "---\nt: 1\n---\nBody";
    const b = "---\nt: 1\n---\n\nBody";
    const c = minimalChange(a, b);
    expect(c).toEqual({ from: "---\nt: 1\n---\n".length, to: "---\nt: 1\n---\n".length, insert: "\n" });
    expect(apply(a, c)).toBe(b);
  });

  test("returns a deletion of extra blank lines (gappy → spaced)", () => {
    const a = "---\nt: 1\n---\n\n\n\nBody";
    const b = "---\nt: 1\n---\n\nBody";
    const c = minimalChange(a, b);
    expect(c.insert).toBe("");
    expect(apply(a, c)).toBe(b);
  });

  test("identical strings → empty no-op change", () => {
    const a = "same";
    expect(minimalChange(a, a)).toEqual({ from: 4, to: 4, insert: "" });
  });
});

describe("normalizeFrontmatterSpacing", () => {
  test("inserts a blank line when frontmatter butts up against the body", () => {
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---\nBody")).toBe(
      "---\ntitle: Hi\n---\n\nBody",
    );
  });

  test("collapses multiple blank lines to exactly one", () => {
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---\n\n\n\nBody")).toBe(
      "---\ntitle: Hi\n---\n\nBody",
    );
  });

  test("is a no-op when already correctly spaced (idempotent)", () => {
    const ok = "---\ntitle: Hi\n---\n\nBody";
    expect(normalizeFrontmatterSpacing(ok)).toBe(ok);
    expect(normalizeFrontmatterSpacing(normalizeFrontmatterSpacing(ok))).toBe(ok);
  });

  test("leaves documents without frontmatter untouched", () => {
    expect(normalizeFrontmatterSpacing("# Just a heading\n\nText")).toBe(
      "# Just a heading\n\nText",
    );
    expect(normalizeFrontmatterSpacing("")).toBe("");
    // A `---` that is not on line 1 is not frontmatter.
    expect(normalizeFrontmatterSpacing("intro\n---\nkey: v\n---\nbody")).toBe(
      "intro\n---\nkey: v\n---\nbody",
    );
  });

  test("leaves frontmatter-only documents untouched (no body)", () => {
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---\n")).toBe("---\ntitle: Hi\n---\n");
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---")).toBe("---\ntitle: Hi\n---");
    // Trailing blank lines only (no real body) → left as-is, no dangling blank line added.
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---\n\n\n")).toBe(
      "---\ntitle: Hi\n---\n\n\n",
    );
  });

  test("handles an empty frontmatter block", () => {
    expect(normalizeFrontmatterSpacing("---\n---\nBody")).toBe("---\n---\n\nBody");
  });

  test("preserves CRLF line endings", () => {
    expect(normalizeFrontmatterSpacing("---\r\ntitle: Hi\r\n---\r\nBody")).toBe(
      "---\r\ntitle: Hi\r\n---\r\n\r\nBody",
    );
    const okCrlf = "---\r\ntitle: Hi\r\n---\r\n\r\nBody";
    expect(normalizeFrontmatterSpacing(okCrlf)).toBe(okCrlf);
  });

  test("does not strip indentation of the first body line", () => {
    expect(normalizeFrontmatterSpacing("---\ntitle: Hi\n---\n    indented code")).toBe(
      "---\ntitle: Hi\n---\n\n    indented code",
    );
  });
});
