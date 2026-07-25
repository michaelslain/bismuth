import { describe, expect, it } from "bun:test";
import { createRenameSettleRegistry } from "./renameSettle";

// The registry that carries a brand-new note from the placeholder name it was CREATED under to
// the name the user actually keeps. The new-note template's write/{{title}}/{{cursor}}/note-cache
// prime all hang off this promise, so the contracts below are load-bearing:
//   • registration is synchronous (a fast Enter can report before the create even lands);
//   • EVERY way an inline rename can end must resolve it — including the abandon paths, or a
//     user who keeps "Untitled" silently gets no template at all;
//   • it resolves at most once, so a blur/cleanup report after a commit can't retarget the write.

describe("createRenameSettleRegistry", () => {
  it("resolves with the renamed path", async () => {
    const reg = createRenameSettleRegistry();
    const p = reg.waitFor("Untitled.md");
    reg.report("Untitled.md", "Grocery List.md");
    expect(await p).toBe("Grocery List.md");
  });

  it("registers synchronously, so a report on the very next line is never dropped", () => {
    const reg = createRenameSettleRegistry();
    reg.waitFor("Untitled.md"); // no await anywhere
    expect(reg.size).toBe(1);
  });

  it("an abandoned rename (reported at the created path) still resolves", async () => {
    const reg = createRenameSettleRegistry();
    const p = reg.waitFor("Untitled.md");
    reg.report("Untitled.md", "Untitled.md"); // Escape / empty input / kept the placeholder
    expect(await p).toBe("Untitled.md");
  });

  it("resolves at most once — a later blur/cleanup report cannot retarget the write", async () => {
    const reg = createRenameSettleRegistry();
    const p = reg.waitFor("Untitled.md");
    reg.report("Untitled.md", "Grocery List.md");
    reg.report("Untitled.md", "Untitled.md"); // stale unmount report arriving after the commit
    expect(await p).toBe("Grocery List.md");
    expect(reg.size).toBe(0);
  });

  it("ignores unknown keys — an ordinary rename of a pre-existing file reports into the void", () => {
    const reg = createRenameSettleRegistry();
    expect(() => reg.report("Some Old Note.md", "Renamed.md")).not.toThrow();
    expect(reg.size).toBe(0);
  });

  it("keeps concurrent creates independent", async () => {
    const reg = createRenameSettleRegistry();
    const a = reg.waitFor("Untitled.md");
    const b = reg.waitFor("Untitled 2.md");
    reg.report("Untitled 2.md", "Second.md");
    reg.report("Untitled.md", "First.md");
    expect(await a).toBe("First.md");
    expect(await b).toBe("Second.md");
    expect(reg.size).toBe(0);
  });

  it("cancel() drops a waiter (a create that failed) and makes later reports inert", async () => {
    const reg = createRenameSettleRegistry();
    const p = reg.waitFor("Untitled.md");
    expect(reg.cancel("Untitled.md")).toBe(true);
    expect(reg.cancel("Untitled.md")).toBe(false); // idempotent
    reg.report("Untitled.md", "Grocery List.md");
    // Nothing resolves it — no file exists to template. Assert by racing a sentinel.
    const sentinel = Symbol("pending");
    expect(await Promise.race([p, Promise.resolve(sentinel)])).toBe(sentinel);
  });
});
