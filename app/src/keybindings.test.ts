// app/src/keybindings.test.ts
import { describe, it, expect } from "bun:test";
import { parseCombo, matchesCombo, matchesKeybinding, eventToCombo, modifierFamily, codeToKey } from "./keybindings";

// Minimal KeyboardEvent stand-in (the matcher reads key/code + the four mods).
function ev(
  key: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; code: string }> = {},
): KeyboardEvent {
  return {
    key,
    code: mods.code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  } as KeyboardEvent;
}

describe("parseCombo", () => {
  it("parses modifiers and the final key", () => {
    expect(parseCombo("Mod+Shift+D")).toEqual({ mod: true, alt: false, shift: true, key: "d" });
    expect(parseCombo("Alt+T")).toEqual({ mod: false, alt: true, shift: false, key: "t" });
    expect(parseCombo("Mod+`")).toEqual({ mod: true, alt: false, shift: false, key: "`" });
  });

  it("folds Cmd/Ctrl/Meta tokens into `mod`", () => {
    expect(parseCombo("Cmd+P")?.mod).toBe(true);
    expect(parseCombo("Ctrl+P")?.mod).toBe(true);
    expect(parseCombo("Meta+P")?.mod).toBe(true);
  });

  it("normalizes key aliases and is whitespace/case tolerant", () => {
    expect(parseCombo("Mod+Alt+Left")?.key).toBe("arrowleft");
    expect(parseCombo("mod + alt + ArrowRight")?.key).toBe("arrowright");
    expect(parseCombo("Plus")?.key).toBe("+");
    expect(parseCombo("Esc")?.key).toBe("escape");
  });

  it("rejects empty / modifier-only combos", () => {
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("   ")).toBeNull();
  });
});

describe("matchesCombo — exact modifier matching", () => {
  it("matches Mod via either meta or ctrl", () => {
    expect(matchesCombo(ev("p", { meta: true }), "Mod+P")).toBe(true);
    expect(matchesCombo(ev("p", { ctrl: true }), "Mod+P")).toBe(true);
  });

  it("requires the mod when the combo asks for it", () => {
    expect(matchesCombo(ev("p"), "Mod+P")).toBe(false);
  });

  it("rejects extra modifiers not in the combo (keeps split-right vs split-down distinct)", () => {
    // Mod+D must NOT fire when Shift is also held…
    expect(matchesCombo(ev("d", { meta: true }), "Mod+D")).toBe(true);
    expect(matchesCombo(ev("d", { meta: true, shift: true }), "Mod+D")).toBe(false);
    // …and Mod+Shift+D must NOT fire without Shift.
    expect(matchesCombo(ev("d", { meta: true, shift: true }), "Mod+Shift+D")).toBe(true);
    expect(matchesCombo(ev("d", { meta: true }), "Mod+Shift+D")).toBe(false);
  });

  it("rejects mod when the combo has none (Alt+T must not fire under Cmd+Alt+T)", () => {
    expect(matchesCombo(ev("t", { alt: true }), "Alt+T")).toBe(true);
    expect(matchesCombo(ev("t", { alt: true, meta: true }), "Alt+T")).toBe(false);
  });

  it("is case-insensitive on the key (shift uppercases the event key)", () => {
    expect(matchesCombo(ev("D", { meta: true, shift: true }), "Mod+Shift+D")).toBe(true);
  });

  it("matches arrow and backtick keys", () => {
    expect(matchesCombo(ev("ArrowLeft", { meta: true, alt: true }), "Mod+Alt+ArrowLeft")).toBe(true);
    expect(matchesCombo(ev("`", { meta: true }), "Mod+`")).toBe(true);
  });

  it("matches via physical code when Option composes a character (macOS)", () => {
    // Alt+S on macOS: browser reports key "ß" but code "KeyS".
    expect(matchesCombo(ev("ß", { alt: true, code: "KeyS" }), "Alt+S")).toBe(true);
    // Alt+T → "†"; Mod+Alt+= → "≠".
    expect(matchesCombo(ev("†", { alt: true, code: "KeyT" }), "Alt+T")).toBe(true);
    expect(matchesCombo(ev("≠", { meta: true, alt: true, code: "Equal" }), "Mod+Alt+=")).toBe(true);
  });

  it("still rejects the wrong physical key under Option", () => {
    expect(matchesCombo(ev("ß", { alt: true, code: "KeyS" }), "Alt+A")).toBe(false);
  });
});

describe("codeToKey — physical key resolution", () => {
  it("resolves letters, digits, numpad, and punctuation", () => {
    expect(codeToKey("KeyS")).toBe("s");
    expect(codeToKey("Digit1")).toBe("1");
    expect(codeToKey("Numpad5")).toBe("5");
    expect(codeToKey("Equal")).toBe("=");
    expect(codeToKey("Backquote")).toBe("`");
    expect(codeToKey("Space")).toBe(" ");
  });

  it("returns null for unmapped / named codes (event.key handles those)", () => {
    expect(codeToKey("ArrowLeft")).toBeNull();
    expect(codeToKey("Enter")).toBeNull();
    expect(codeToKey(undefined)).toBeNull();
    expect(codeToKey("")).toBeNull();
  });
});

describe("matchesKeybinding — comma-separated alternatives", () => {
  it("matches any one of the listed combos", () => {
    expect(matchesKeybinding(ev("`", { meta: true }), "Mod+`, Mod+J")).toBe(true);
    expect(matchesKeybinding(ev("j", { meta: true }), "Mod+`, Mod+J")).toBe(true);
    expect(matchesKeybinding(ev("k", { meta: true }), "Mod+`, Mod+J")).toBe(false);
  });

  it("returns false for empty / nullish settings", () => {
    expect(matchesKeybinding(ev("p", { meta: true }), "")).toBe(false);
    expect(matchesKeybinding(ev("p", { meta: true }), undefined)).toBe(false);
    expect(matchesKeybinding(ev("p", { meta: true }), null)).toBe(false);
  });
});

describe("modifierFamily", () => {
  it("folds platform modifier tokens into a family, returns null for keys", () => {
    expect(modifierFamily("Mod")).toBe("mod");
    expect(modifierFamily("cmd")).toBe("mod");
    expect(modifierFamily("Ctrl")).toBe("mod");
    expect(modifierFamily("Option")).toBe("alt");
    expect(modifierFamily("Shift")).toBe("shift");
    expect(modifierFamily("D")).toBeNull();
    expect(modifierFamily("ArrowLeft")).toBeNull();
  });
});

describe("eventToCombo — recording a shortcut", () => {
  it("builds a combo from modifiers + key, using Mod for meta/ctrl", () => {
    expect(eventToCombo(ev("d", { meta: true, shift: true }))).toBe("Mod+Shift+D");
    expect(eventToCombo(ev("p", { ctrl: true }))).toBe("Mod+P");
    expect(eventToCombo(ev("ArrowLeft", { meta: true, alt: true }))).toBe("Mod+Alt+ArrowLeft");
    expect(eventToCombo(ev(" ", { alt: true }))).toBe("Alt+Space");
    expect(eventToCombo(ev("t", { alt: true }))).toBe("Alt+T");
  });

  it("records the physical key when Option composes a character (macOS)", () => {
    expect(eventToCombo(ev("ß", { alt: true, code: "KeyS" }))).toBe("Alt+S");
    expect(eventToCombo(ev("≠", { meta: true, alt: true, code: "Equal" }))).toBe("Mod+Alt+=");
  });

  it("returns null for a bare modifier press (keep listening)", () => {
    expect(eventToCombo(ev("Shift", { shift: true }))).toBeNull();
    expect(eventToCombo(ev("Meta", { meta: true }))).toBeNull();
    expect(eventToCombo(ev("Control", { ctrl: true }))).toBeNull();
  });
});
