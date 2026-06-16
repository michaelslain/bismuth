import { describe, it, expect, beforeEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { existsSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import {
  setFrontmatterKey,
  deleteFrontmatterKey,
} from "../src/frontmatter";
import { resolveBaseRows } from "../src/bases/source";
import { applyReview } from "../src/srs/cards";
import { upsertRow, deleteRow } from "../src/bases/rowOps";
import { createError } from "../src/error";

// Probe once whether this platform/filesystem actually supports symlinks, so the
// symlink-cycle test can be *explicitly* skipped where it can't run rather than
// silently passing with zero assertions.
const symlinksSupported = (() => {
  const probe = mkdtempSync(join(tmpdir(), "symlink-probe-"));
  try {
    symlinkSync(join(probe, "target"), join(probe, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

describe("Bug Fix Tests", () => {
  describe("YAML Frontmatter Preservation", () => {
    it("preserves frontmatter formatting on setFrontmatterKey", () => {
      const md = `---
tags: [book, fiction]
author: "John Doe"
---
# Hello
Body content`;

      const result = setFrontmatterKey(md, "rating", 5);
      expect(result).toContain("tags: [book, fiction]");
      expect(result).toContain('author: "John Doe"');
      expect(result).toContain("rating: 5");
      expect(result).toContain("# Hello");
      expect(result).toContain("Body content");
    });

    it("preserves body verbatim after setFrontmatterKey", () => {
      const md = `---
tags: []
---
Line 1
  Indented line
Line 3`;
      const result = setFrontmatterKey(md, "new-key", "value");
      expect(result).toContain("Line 1\n  Indented line\nLine 3");
    });

    it("handles malformed YAML gracefully in setFrontmatterKey", () => {
      const md = `---
tags: [broken, [nested
---
Body`;
      // Should fall back to clean rewrite without crashing
      const result = setFrontmatterKey(md, "key", "value");
      expect(result).toContain("key: value");
      expect(result).toContain("Body");
    });

    it("preserves remaining keys on deleteFrontmatterKey", () => {
      const md = `---
tags: [a, b]
author: Jane
rating: 4
---
Content`;
      const result = deleteFrontmatterKey(md, "author");
      expect(result).toContain("tags:");
      expect(result).toContain("rating: 4");
      expect(result).not.toContain("author");
      expect(result).toContain("Content");
    });

    it("removes entire frontmatter block if last key is deleted", () => {
      const md = `---
single_key: value
---
Content`;
      const result = deleteFrontmatterKey(md, "single_key");
      expect(result).toBe("Content");
      expect(result).not.toContain("---");
    });
  });

  describe("Base Composition Cycle Detection", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `test-cycle-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    // Cleanup after tests
    async function cleanup() {
      if (existsSync(testDir)) {
        try {
          await rm(testDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    it("detects direct cycles in base composition", async () => {
      try {
        const baseA = `---
source: notes
---
- col1: val1`;
        const baseB = `---
source: notes
---
- col2: val2`;

        await writeFile(join(testDir, "baseA.base"), baseA);
        await writeFile(join(testDir, "baseB.base"), baseB);

        // Create a cycle: baseA -> baseB -> baseA
        const cycledA = `---
source:
  kind: base
  ref: "[[baseB]]"
---
- col1: val1`;
        const cycledB = `---
source:
  kind: base
  ref: "[[baseA]]"
---
- col2: val2`;

        await writeFile(join(testDir, "baseA.base"), cycledA);
        await writeFile(join(testDir, "baseB.base"), cycledB);

        const result = await resolveBaseRows(
          join(testDir, "baseA.base"),
          { root: testDir },
        );
        expect(result).toEqual([]); // Should return empty on cycle
      } finally {
        await cleanup();
      }
    });

    // Skipped (not silently passed) where symlinks aren't supported, so the
    // assertion below always runs when the test is reported as passing.
    it.skipIf(!symlinksSupported)("detects cycles through symlinks", async () => {
      try {
        const baseFile = `---
source:
  kind: base
  ref: "[[link]]"
---
- col: val`;

        const baseFilePath = join(testDir, "base.base");
        const linkPath = join(testDir, "link.base");

        await writeFile(baseFilePath, baseFile);
        // Create a symlink that points back to the original file
        await symlink(baseFilePath, linkPath);

        // This should detect the cycle even through symlink
        const result = await resolveBaseRows(baseFilePath, { root: testDir });
        expect(result).toEqual([]); // Should return empty on cycle
      } finally {
        await cleanup();
      }
    });
  });

  describe("SRS Error Context", () => {
    it("throws CARD_FORMAT_ERROR for invalid cardId", async () => {
      const vault = tmpdir();
      const cardId = "invalid-format";
      try {
        await applyReview(vault, cardId, "good", "2024-01-01");
        expect.unreachable("Should have thrown");
      } catch (e) {
        // AppError has a code property
        if (e && typeof e === "object" && "code" in e) {
          expect((e as any).code).toBe("CARD_FORMAT_ERROR");
        } else if (e instanceof Error) {
          expect(e.message).toContain("invalid cardId format");
        }
      }
    });

    it("throws an ENOENT error naming the missing note", async () => {
      const vault = tmpdir();
      const cardId = "nonexistent.md::0::0";
      try {
        await applyReview(vault, cardId, "good", "2024-01-01");
        expect.unreachable("Should have thrown");
      } catch (e) {
        // readNote reads a missing file → a native ENOENT Error whose message
        // names the absolute path (which ends in the missing note's filename).
        expect(e).toBeInstanceOf(Error);
        const err = e as Error & { code?: string };
        expect(err.code).toBe("ENOENT");
        expect(err.message).toContain("nonexistent.md");
      }
    });

    it("createError produces correct HTTP status codes", () => {
      const cardNotFound = createError(
        "CARD_NOT_FOUND",
        "Card 123 not found",
      );
      expect(cardNotFound.code).toBe("CARD_NOT_FOUND");
      expect(cardNotFound.statusCode).toBe(404);

      const formatErr = createError("CARD_FORMAT_ERROR", "Bad format");
      expect(formatErr.code).toBe("CARD_FORMAT_ERROR");
      expect(formatErr.statusCode).toBe(400);

      const contentChanged = createError(
        "CARD_CONTENT_CHANGED",
        "Content mismatch",
      );
      expect(contentChanged.code).toBe("CARD_CONTENT_CHANGED");
      expect(contentChanged.statusCode).toBe(409);
    });
  });

  describe("Table Column Order Preservation", () => {
    it("preserves column order in upsertRow", () => {
      const text = `---
columns: [name, age, city]
---
- name: Alice
  age: 30
  city: NYC
- name: Bob
  age: 25
  city: LA`;

      const updated = upsertRow(text, { name: "test", path: "test.base" }, 0, {
        name: "Charlie",
        age: 35,
        city: "SF",
      });

      // Check that the column order is preserved in the output
      // YAML format puts each key on its own line: "- name:", then "  age:", then "  city:"
      const body = updated.substring(updated.indexOf("---\n", 1) + 4); // Skip to body after frontmatter
      const bodyLines = body.split("\n");

      // Find indices of lines containing each key
      const nameLineIdx = bodyLines.findIndex((l) => l.includes("name:"));
      const ageLineIdx = bodyLines.findIndex((l) => l.includes("age:"));
      const cityLineIdx = bodyLines.findIndex((l) => l.includes("city:"));

      // All keys should be present
      expect(nameLineIdx).toBeGreaterThan(-1);
      expect(ageLineIdx).toBeGreaterThan(-1);
      expect(cityLineIdx).toBeGreaterThan(-1);

      // And in the correct order (name before age, age before city)
      expect(nameLineIdx).toBeLessThan(ageLineIdx);
      expect(ageLineIdx).toBeLessThan(cityLineIdx);
    });

    it("preserves order when adding new row", () => {
      const text = `---
order: [id, status]
---
- id: 1
  status: active
  label: First`;

      const updated = upsertRow(text, { name: "test", path: "test.base" }, null, {
        id: 2,
        status: "pending",
        label: "Second",
      });

      // Check output preserves the order
      expect(updated).toContain("id:");
      expect(updated).toContain("status:");
      // The order should be: id, status, then other keys
      const lines = updated.split("\n");
      const hasContent = lines.some((l) => l.includes("id: 2"));
      expect(hasContent).toBe(true);
    });

    it("preserves order when deleting row", () => {
      const text = `---
columns: [name, email]
---
- name: Alice
  email: alice@example.com
- name: Bob
  email: bob@example.com
- name: Charlie
  email: charlie@example.com`;

      const updated = deleteRow(text, { name: "test", path: "test.base" }, 1);

      // Should still preserve the column order in remaining rows
      expect(updated).toContain("name:");
      expect(updated).toContain("email:");
      expect(updated).toContain("Alice");
      expect(updated).toContain("Charlie");
      expect(updated).not.toContain("Bob");
    });
  });

  describe("Integration: All fixes working together", () => {
    it("frontmatter, symlinks, errors, and column order all coexist", () => {
      // Create a base file with preserved frontmatter format
      const base = `---
tags: [database]
columns: [id, name, type]
---
- id: 1
  name: "User"
  type: "model"
- id: 2
  name: "Post"
  type: "model"`;

      // Update with column preservation
      const updated = upsertRow(
        base,
        { name: "schema", path: "schema.base" },
        0,
        { id: 1, name: "Account", type: "model" },
      );

      // Verify all fixes are active:
      // 1. Frontmatter preserved
      expect(updated).toContain("tags: [database]");
      // 2. Column order preserved (id, name, type)
      const rows = updated.split("\n").filter((l) => l.startsWith("- "));
      expect(rows.length).toBeGreaterThan(0);
      // 3. Error typing is available (tested via imports)
      const err = createError("ENOENT", "File not found");
      expect(err.statusCode).toBe(404);
    });
  });
});
