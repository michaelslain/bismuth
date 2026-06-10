import { test, expect, describe } from "bun:test";
import { createServer } from "../src/server";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeVault } from "./helpers";

describe("search + replace endpoints", () => {
  test("POST /search returns ranked grouped results", async () => {
    const vault = makeVault({ "search.md": "# Search\nbody", "a.md": "has search inside" });
    const memory = mkdtempSync(join(tmpdir(), "search-mem-"));
    const s = createServer({ vault, memory, port: 0 });
    const base = `http://localhost:${s.port}`;
    try {
      const res = await fetch(`${base}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "search", opts: { caseSensitive: false, wholeWord: false, regex: false } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].path).toBe("search.md");
    } finally {
      s.stop(true);
    }
  });

  test("POST /replace rewrites matched files", async () => {
    const vault = makeVault({ "a.md": "brown", "b.md": "brown brown" });
    const memory = mkdtempSync(join(tmpdir(), "search-mem-"));
    const s = createServer({ vault, memory, port: 0 });
    const base = `http://localhost:${s.port}`;
    try {
      const res = await fetch(`${base}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "brown", replacement: "red", opts: { caseSensitive: false, wholeWord: false, regex: false }, scope: "vault" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.replaced).toBe(3);
      expect(readFileSync(join(vault, "a.md"), "utf8")).toBe("red");
    } finally {
      s.stop(true);
    }
  });
});
