// core/test/agentBackends/agentsMd.test.ts
import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertAgentsMdBlock, writeAgentsMdBlock } from "../../src/agentBackends/agentsMd";

describe("upsertAgentsMdBlock (pure)", () => {
  test("creates a fresh block when the file doesn't exist yet", () => {
    const out = upsertAgentsMdBlock(null, "Hello from Bismuth.");
    expect(out).toContain("bismuth:managed:start");
    expect(out).toContain("bismuth:managed:end");
    expect(out).toContain("Hello from Bismuth.");
    // Markers appear exactly once each.
    expect(out.split("bismuth:managed:start").length - 1).toBe(1);
    expect(out.split("bismuth:managed:end").length - 1).toBe(1);
  });

  test("appends the block after existing content when no markers are present", () => {
    const existing = "# My Notes\n\nSome hand-written prose.\n";
    const out = upsertAgentsMdBlock(existing, "Persona digest.");
    expect(out.startsWith("# My Notes\n\nSome hand-written prose.")).toBe(true);
    expect(out).toContain("Persona digest.");
  });

  test("updates an existing block in place, preserving prose BEFORE and AFTER it", () => {
    const first = upsertAgentsMdBlock("# Top\n\nBefore text.\n", "v1 content");
    const withTrailer = `${first}\nAfter text.\n`;
    const second = upsertAgentsMdBlock(withTrailer, "v2 content");

    expect(second).toContain("# Top");
    expect(second).toContain("Before text.");
    expect(second).toContain("After text.");
    expect(second).toContain("v2 content");
    expect(second).not.toContain("v1 content");
    // Still exactly one block.
    expect(second.split("bismuth:managed:start").length - 1).toBe(1);
  });

  test("is idempotent: re-running with the same content on its own output is a no-op", () => {
    const first = upsertAgentsMdBlock("# Doc\n\nIntro.\n", "steady content");
    const second = upsertAgentsMdBlock(first, "steady content");
    expect(second).toBe(first);
  });

  test("treats out-of-order markers (end before start) as absent and appends fresh", () => {
    const corrupt = `${"<!-- bismuth:managed:end -->"}\nstray\n${"<!-- bismuth:managed:start -- do not edit below, this block is regenerated automatically -->"}\n`;
    const out = upsertAgentsMdBlock(corrupt, "fresh content");
    expect(out).toContain("fresh content");
    // The original corrupt markers are still there verbatim (untouched), plus a new well-formed pair.
    expect(out.split("bismuth:managed:start").length - 1).toBe(2);
  });

  test("never leaves a trailing run of blank lines after repeated updates", () => {
    let doc: string | null = "# Doc\n";
    for (const c of ["one", "two", "three"]) doc = upsertAgentsMdBlock(doc, c);
    expect(doc).not.toMatch(/\n{3,}$/);
  });
});

describe("writeAgentsMdBlock (effectful, tmp dir)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("creates AGENTS.md at the vault root when absent", () => {
    dir = mkdtempSync(join(tmpdir(), "bismuth-agentsmd-"));
    const ok = writeAgentsMdBlock(dir, "hello");
    expect(ok).toBe(true);
    const path = join(dir, "AGENTS.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("hello");
  });

  test("refreshes an existing AGENTS.md's block without touching surrounding prose", () => {
    dir = mkdtempSync(join(tmpdir(), "bismuth-agentsmd-"));
    const path = join(dir, "AGENTS.md");
    writeFileSync(path, "# Project notes\n\nWritten by a human.\n");
    writeAgentsMdBlock(dir, "first digest");
    writeAgentsMdBlock(dir, "second digest");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Project notes");
    expect(text).toContain("Written by a human.");
    expect(text).toContain("second digest");
    expect(text).not.toContain("first digest");
  });

  test("never throws even against an unwritable path", () => {
    // A path with a NUL byte is invalid on every platform — exercises the try/catch, not a crash.
    expect(() => writeAgentsMdBlock("/nonexistent-\0-vault", "x")).not.toThrow();
  });
});
