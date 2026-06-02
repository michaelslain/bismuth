// app/src/editor/settingsComplete.keybind.test.ts
import { describe, it, expect } from "bun:test";
import type { CompletionContext } from "@codemirror/autocomplete";
import { keybindCompletions } from "./settingsComplete";

// keybindCompletions only reads ctx.pos and ctx.explicit.
function ctx(explicit = true, pos = 100): CompletionContext {
  return { pos, explicit } as unknown as CompletionContext;
}
function labels(valueSoFar: string, explicit = true): string[] {
  const r = keybindCompletions(ctx(explicit), valueSoFar);
  return r ? r.options.map((o) => o.label) : [];
}

describe("keybindCompletions", () => {
  it("offers record + modifiers + keys on an empty value (explicit)", () => {
    const ls = labels("");
    expect(ls[0]).toBe("Record shortcut…"); // boosted to the top
    expect(ls).toContain("Mod");
    expect(ls).toContain("Alt");
    expect(ls).toContain("Shift");
    expect(ls).toContain("A");
    expect(ls).toContain("ArrowLeft");
  });

  it("returns null on an empty value when not explicit and not just after a separator", () => {
    expect(keybindCompletions(ctx(false), "")).toBeNull();
  });

  it("pops automatically right after a '+' separator", () => {
    expect(keybindCompletions(ctx(false), "Mod+")).not.toBeNull();
  });

  it("hides an already-used modifier family (Mod ⇒ no Mod/Cmd/Ctrl/Meta)", () => {
    const ls = labels("Mod+");
    expect(ls).not.toContain("Mod");
    expect(ls).not.toContain("Cmd");
    expect(ls).not.toContain("Ctrl");
    expect(ls).toContain("Alt");
    expect(ls).toContain("Shift");
    expect(ls).toContain("D");
  });

  it("filters the current token by prefix (order-free)", () => {
    const ls = labels("Mod+Sh");
    expect(ls).toEqual(["Shift"]); // only the Shift modifier matches "Sh"
  });

  it("completes a key in any position", () => {
    const ls = labels("Mod+Alt+Arrow");
    expect(ls).toContain("ArrowLeft");
    expect(ls).toContain("ArrowRight");
    expect(ls).not.toContain("Mod");
  });

  it("starts a fresh combo after a comma (alternatives)", () => {
    const ls = labels("Mod+`, ");
    expect(ls).toContain("Mod"); // new combo → Mod available again
    expect(ls).toContain("Shift");
  });

  it("modifier options append '+' so the combo keeps building", () => {
    const r = keybindCompletions(ctx(true), "")!;
    const mod = r.options.find((o) => o.label === "Mod");
    expect(mod?.apply).toBe("Mod+");
  });

  it("the record option carries an apply function (the 3s listener)", () => {
    const r = keybindCompletions(ctx(true), "")!;
    const rec = r.options.find((o) => o.label === "Record shortcut…");
    expect(typeof rec?.apply).toBe("function");
  });
});
