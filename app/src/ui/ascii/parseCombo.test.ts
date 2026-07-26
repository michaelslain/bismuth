import { describe, it, expect } from "bun:test";
import { parseCombo } from "./parseCombo";

describe("parseCombo", () => {
  it("splits a chord into adjacent caps", () => {
    expect(parseCombo("Mod+Shift+D", true)).toEqual([["⌘", "⇧", "D"]]);
    expect(parseCombo("Mod+Shift+D", false)).toEqual([["Ctrl", "Shift", "D"]]);
  });

  it("splits a comma-separated sequence into separate groups", () => {
    expect(parseCombo("Mod+`, Mod+J", true)).toEqual([
      ["⌘", "`"],
      ["⌘", "J"],
    ]);
  });

  it("trims whitespace around commas and pluses", () => {
    expect(parseCombo(" Mod + K , Mod + O ", true)).toEqual([
      ["⌘", "K"],
      ["⌘", "O"],
    ]);
  });

  it("maps Mod to ⌘ on mac and Ctrl elsewhere", () => {
    expect(parseCombo("Mod+K", true)).toEqual([["⌘", "K"]]);
    expect(parseCombo("Mod+K", false)).toEqual([["Ctrl", "K"]]);
  });

  it("maps Cmd/Meta to ⌘ regardless of platform", () => {
    expect(parseCombo("Cmd+K", false)).toEqual([["⌘", "K"]]);
    expect(parseCombo("Meta+K", false)).toEqual([["⌘", "K"]]);
  });

  it("maps Alt/Option and Shift per platform", () => {
    expect(parseCombo("Alt+Shift+X", true)).toEqual([["⌥", "⇧", "X"]]);
    expect(parseCombo("Alt+Shift+X", false)).toEqual([["Alt", "Shift", "X"]]);
    expect(parseCombo("Option+X", false)).toEqual([["⌥", "X"]]);
  });

  it("maps arrow, escape, and enter cap names", () => {
    expect(parseCombo("Up", true)).toEqual([["↑"]]);
    expect(parseCombo("Down", true)).toEqual([["↓"]]);
    expect(parseCombo("Left", true)).toEqual([["←"]]);
    expect(parseCombo("Right", true)).toEqual([["→"]]);
    expect(parseCombo("Escape", true)).toEqual([["esc"]]);
    expect(parseCombo("Esc", true)).toEqual([["esc"]]);
    expect(parseCombo("Enter", true)).toEqual([["↵"]]);
    expect(parseCombo("Return", true)).toEqual([["↵"]]);
    expect(parseCombo("Backspace", true)).toEqual([["⌫"]]);
    expect(parseCombo("Delete", true)).toEqual([["⌫"]]);
    expect(parseCombo("Tab", true)).toEqual([["⇥"]]);
    expect(parseCombo("Space", true)).toEqual([["space"]]);
  });

  it("passes through unrecognized keys literally", () => {
    expect(parseCombo("Mod+`", true)).toEqual([["⌘", "`"]]);
    expect(parseCombo("Q", true)).toEqual([["Q"]]);
  });

  it("returns an empty array for empty/undefined/null input", () => {
    expect(parseCombo("")).toEqual([]);
    expect(parseCombo(undefined)).toEqual([]);
    expect(parseCombo(null)).toEqual([]);
  });
});
