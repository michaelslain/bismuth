// app/src/PaneTree.cleanup.test.ts
// B1: divider-drag pointer listeners must not leak if a split unmounts mid-drag.
// startDrag attaches pointermove/pointerup to window, removed only in `up`. An
// onCleanup must run the same teardown so a mid-drag unmount detaches the window
// listeners (and stops setResizing from firing on a disposed scope).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), "utf8");

describe("PaneTree divider-drag cleanup (B1)", () => {
  const pt = src("PaneTree.tsx");

  it("imports onCleanup from solid-js", () => {
    expect(pt).toMatch(/import\s*\{[^}]*\bonCleanup\b[^}]*\}\s*from\s*"solid-js"/);
  });

  it("hoists the in-flight teardown so onCleanup can reach it", () => {
    // The teardown (`up`) is stashed in a split-scope ref while a drag is active.
    expect(pt).toContain("let endDrag");
    expect(pt).toContain("endDrag = up");
    // `up` clears the ref when it fires normally so cleanup is a no-op afterward.
    expect(pt).toContain("endDrag = null");
  });

  it("registers an onCleanup that runs the in-flight teardown", () => {
    // A mid-drag unmount must detach the window listeners via the same teardown.
    expect(pt).toMatch(/onCleanup\(\s*\(\)\s*=>\s*endDrag\?\.\(\)\s*\)/);
  });

  it("still removes both window listeners in the up handler", () => {
    expect(pt).toContain('window.removeEventListener("pointermove", move)');
    expect(pt).toContain('window.removeEventListener("pointerup", up)');
  });
});
