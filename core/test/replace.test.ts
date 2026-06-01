import { test, expect, describe } from "bun:test";
import { replaceInText, replaceInVault } from "../src/replace";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "replace-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe("replaceInText", () => {
  test("replaces all literal occurrences and counts them", () => {
    const r = replaceInText("brown fox brown", "brown", "red", { caseSensitive: false, wholeWord: false, regex: false });
    expect(r).toEqual({ text: "red fox red", count: 2 });
  });

  test("respects whole-word", () => {
    const r = replaceInText("brownish brown", "brown", "red", { caseSensitive: false, wholeWord: true, regex: false });
    expect(r.text).toBe("brownish red");
    expect(r.count).toBe(1);
  });

  test("regex with capture groups", () => {
    const r = replaceInText("2026-05-31", "(\\d{4})-(\\d{2})", "$2/$1", { caseSensitive: false, wholeWord: false, regex: true });
    expect(r.text).toBe("05/2026-31");
  });

  test("no matches is a no-op with count 0", () => {
    expect(replaceInText("abc", "zzz", "q", { caseSensitive: false, wholeWord: false, regex: false })).toEqual({ text: "abc", count: 0 });
  });
});

describe("replaceInVault", () => {
  test("vault scope rewrites every file with matches", async () => {
    const root = makeVault({ "a.md": "brown", "sub/b.md": "brown brown", "c.md": "nothing" });
    const res = await replaceInVault(root, "brown", "red", { caseSensitive: false, wholeWord: false, regex: false }, "vault");
    expect(res.replaced).toBe(3);
    expect(res.files.sort()).toEqual(["a.md", "sub/b.md"]);
    expect(readFileSync(join(root, "a.md"), "utf8")).toBe("red");
    expect(readFileSync(join(root, "sub/b.md"), "utf8")).toBe("red red");
    expect(readFileSync(join(root, "c.md"), "utf8")).toBe("nothing");
  });

  test("path scope only touches one file", async () => {
    const root = makeVault({ "a.md": "brown", "b.md": "brown" });
    const res = await replaceInVault(root, "brown", "red", { caseSensitive: false, wholeWord: false, regex: false }, "a.md");
    expect(res.files).toEqual(["a.md"]);
    expect(readFileSync(join(root, "b.md"), "utf8")).toBe("brown");
  });
});
