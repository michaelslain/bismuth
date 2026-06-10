// app/src/Terminal.cleanup.test.ts
// B8/B20: TerminalTab's onMount is async and awaits document.fonts.load(...)
// BEFORE creating the WebSocket / Xterm / ResizeObserver / cursor / listeners.
// Solid only runs onCleanup callbacks registered while the owner is alive, so if
// the tab is closed during that await, a cleanup registered AFTER the await would
// never fire — leaking the PTY WebSocket, ResizeObserver, xterm, cursor element,
// and document/container mouse listeners. The fix registers a synchronous
// onCleanup BEFORE the await (closing over component-scoped refs) and early-returns
// from the post-await body if the tab was disposed mid-load.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), "utf8");

describe("TerminalTab font-load cleanup (B8/B20)", () => {
  const tt = src("Terminal.tsx");

  it("imports onCleanup from solid-js", () => {
    expect(tt).toMatch(/import\s*\{[^}]*\bonCleanup\b[^}]*\}\s*from\s*"solid-js"/);
  });

  it("declares a disposed flag before the font-load await", () => {
    const onMountIdx = tt.indexOf("onMount(async () =>");
    const awaitIdx = tt.indexOf("await document.fonts.load");
    const disposedIdx = tt.indexOf("let disposed = false");
    expect(onMountIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(disposedIdx).toBeGreaterThan(-1);
    // disposed must be declared after onMount opens but before the await.
    expect(disposedIdx).toBeGreaterThan(onMountIdx);
    expect(disposedIdx).toBeLessThan(awaitIdx);
  });

  it("registers onCleanup synchronously before the await", () => {
    const awaitIdx = tt.indexOf("await document.fonts.load");
    // Find the onCleanup registered inside onMount (the first one after onMount opens).
    const onMountIdx = tt.indexOf("onMount(async () =>");
    const cleanupIdx = tt.indexOf("onCleanup(", onMountIdx);
    expect(cleanupIdx).toBeGreaterThan(onMountIdx);
    expect(cleanupIdx).toBeLessThan(awaitIdx);
  });

  it("flips disposed=true inside the cleanup", () => {
    expect(tt).toContain("disposed = true");
  });

  it("early-returns from the post-await body when disposed", () => {
    const awaitIdx = tt.indexOf("await document.fonts.load");
    const guardIdx = tt.indexOf("if (disposed) return", awaitIdx);
    expect(guardIdx).toBeGreaterThan(awaitIdx);
  });

  it("tears down every async-created resource in the cleanup", () => {
    // The cleanup closure must reach the WebSocket, ResizeObserver, xterm,
    // cursor element, listeners, and xterm subscriptions.
    const onMountIdx = tt.indexOf("onMount(async () =>");
    const cleanupStart = tt.indexOf("onCleanup(", onMountIdx);
    const cleanupBody = tt.slice(cleanupStart, tt.indexOf("});", cleanupStart));
    expect(cleanupBody).toContain("ro?.disconnect()");
    // Closes with code 1000 so the backend treats it as an intentional teardown
    // (kill the PTY now) rather than a drop to keep alive for reattach.
    expect(cleanupBody).toContain('ws?.close(1000, "dispose")');
    expect(cleanupBody).toContain("term?.dispose()");
    expect(cleanupBody).toContain("cursorEl?.remove()");
    expect(cleanupBody).toContain('removeEventListener("mousedown"');
    expect(cleanupBody).toContain('removeEventListener("mouseup"');
    expect(cleanupBody).toContain("dataListener?.dispose()");
    expect(cleanupBody).toContain("renderSub?.dispose()");
    expect(cleanupBody).toContain("cursorMoveSub?.dispose()");
  });

  it("hoists ro / cursorEl / mouse handlers so the early cleanup can reach them", () => {
    // These were previously created with `const` AFTER the await; they must now be
    // component-scoped (or onMount-scoped above the cleanup) refs.
    expect(tt).toMatch(/let\s+ro:\s*ResizeObserver\s*\|\s*undefined/);
    expect(tt).toMatch(/let\s+cursorEl:\s*HTMLDivElement\s*\|\s*undefined/);
    expect(tt).toMatch(/let\s+downHandler/);
    expect(tt).toMatch(/let\s+upHandler/);
    // And they must be assigned (not re-declared) in the post-await body.
    expect(tt).toContain("ro = new ResizeObserver");
    expect(tt).toContain("cursorEl = document.createElement");
    expect(tt).toContain("downHandler = ");
    expect(tt).toContain("upHandler = ");
  });

  it("does not register a second post-await onCleanup that would be lost on mid-load close", () => {
    // Only one onCleanup should exist inside onMount (the synchronous one).
    const onMountIdx = tt.indexOf("onMount(async () =>");
    const onMountBody = tt.slice(onMountIdx);
    const matches = onMountBody.match(/onCleanup\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
