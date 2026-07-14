// app/src/chatSlashCommands.test.ts
import { describe, it, expect } from "bun:test";
import { parseChatSlashCommand, CLIENT_SLASH_COMMANDS, withClientSlashCommands, chromeToggleNote, computeChromeToggle } from "./chatSlashCommands";

describe("parseChatSlashCommand", () => {
  it("parses `/rename <name>`", () => {
    expect(parseChatSlashCommand("/rename Planning")).toEqual({ kind: "rename", name: "Planning" });
  });
  it("keeps a multi-word rename name", () => {
    expect(parseChatSlashCommand("/rename Q3 Planning Sync")).toEqual({ kind: "rename", name: "Q3 Planning Sync" });
  });
  it("`/rename` with no arg → empty name (caller reverts to auto label)", () => {
    expect(parseChatSlashCommand("/rename")).toEqual({ kind: "rename", name: "" });
  });
  it("parses `/color <token>` keeping the raw arg (caller resolves it)", () => {
    expect(parseChatSlashCommand("/color blue")).toEqual({ kind: "color", arg: "blue" });
    expect(parseChatSlashCommand("/color #ffcc00")).toEqual({ kind: "color", arg: "#ffcc00" });
  });
  it("`/colour` (British spelling) also parses as color", () => {
    expect(parseChatSlashCommand("/colour green")).toEqual({ kind: "color", arg: "green" });
  });
  it("is case-insensitive on the command word", () => {
    expect(parseChatSlashCommand("/RENAME Foo")).toEqual({ kind: "rename", name: "Foo" });
  });
  it("trims surrounding whitespace", () => {
    expect(parseChatSlashCommand("  /rename  Foo  ")).toEqual({ kind: "rename", name: "Foo" });
  });
  it("parses `/chrome` (no args) as a chrome toggle", () => {
    expect(parseChatSlashCommand("/chrome")).toEqual({ kind: "chrome" });
  });
  it("is case-insensitive on `/chrome`", () => {
    expect(parseChatSlashCommand("/CHROME")).toEqual({ kind: "chrome" });
    expect(parseChatSlashCommand("/Chrome")).toEqual({ kind: "chrome" });
  });
  it("trims whitespace around `/chrome`", () => {
    expect(parseChatSlashCommand("  /chrome  ")).toEqual({ kind: "chrome" });
  });
  it("ignores trailing args on `/chrome` (arg not captured)", () => {
    expect(parseChatSlashCommand("/chrome foo")).toEqual({ kind: "chrome" });
  });
  it("returns null for a non-local command (falls through to the model)", () => {
    expect(parseChatSlashCommand("/compact")).toBeNull();
    expect(parseChatSlashCommand("/mcp")).toBeNull();
  });
  it("returns null for plain prose", () => {
    expect(parseChatSlashCommand("rename this chat please")).toBeNull();
    expect(parseChatSlashCommand("")).toBeNull();
  });
});

// BUG #87 ("/chrome command missing"): the "/" autocomplete popover used to be built ONLY from the
// backend's manifest.slashCommands, which never lists these client-side commands — so `/chrome`
// never appeared in the picker even though parseChatSlashCommand understood it fine. These tests
// cover the list ChatView splices in (withClientSlashCommands) rather than the DOM popover itself.
describe("CLIENT_SLASH_COMMANDS / withClientSlashCommands (BUG #87 autocomplete fix)", () => {
  it("lists rename, color, and chrome with a non-empty detail each", () => {
    const names = CLIENT_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toEqual(["rename", "color", "chrome"]);
    for (const c of CLIENT_SLASH_COMMANDS) expect(c.detail.length).toBeGreaterThan(0);
  });

  it("appends the client commands to an empty (pre-manifest) list, so /chrome shows before any session exists", () => {
    expect(withClientSlashCommands([])).toEqual(["rename", "color", "chrome"]);
  });

  it("appends after the backend's own commands, preserving their order", () => {
    expect(withClientSlashCommands(["compact", "mcp"])).toEqual(["compact", "mcp", "rename", "color", "chrome"]);
  });

  it("dedupes: a backend command sharing a client command's name isn't duplicated", () => {
    expect(withClientSlashCommands(["chrome"])).toEqual(["chrome", "rename", "color"]);
  });
});

// BUG #87 (visible-feedback half): the transcript confirmation posted when /chrome (or the header
// Globe pill) toggles --chrome. The wording is load-bearing — it must state the NEW state and that
// it lands on the next message (the live session respawns then), and must NOT claim the current
// in-flight turn changed (--chrome is spawn-fixed).
describe("chromeToggleNote (BUG #87 visible feedback)", () => {
  it("enabled → states enabled + 'for this chat' + 'next message'", () => {
    expect(chromeToggleNote(true)).toBe("Browser (--chrome) enabled for this chat — takes effect from your next message.");
  });
  it("disabled → states disabled + 'for this chat' + 'next message'", () => {
    expect(chromeToggleNote(false)).toBe("Browser (--chrome) disabled for this chat — takes effect from your next message.");
  });
  it("never falsely says the current/new session is unaffected", () => {
    expect(chromeToggleNote(true)).not.toContain("unaffected");
    expect(chromeToggleNote(false)).not.toContain("unaffected");
  });
  it("never claims it only applies to NEW/future sessions (the old broken wording)", () => {
    expect(chromeToggleNote(true)).not.toContain("new sessions");
  });
});

// BUG #87 RE-FIX: the toggle flip + its transcript note must stay in lockstep — turning --chrome ON
// (from OFF) yields the ENABLED note AND the new state `true`; turning it OFF yields the disabled
// note AND `false`. The message reflects the NEW state, never the pre-toggle one (the user's bounce:
// `/chrome` to enable STILL reported "disabled"). computeChromeToggle is the single pure source the
// slash command AND the Globe pill both go through so they can't drift.
describe("computeChromeToggle (BUG #87 re-fix: new-state ⇄ message mapping)", () => {
  it("toggling ON (from off) → enabled note + computerUse true", () => {
    expect(computeChromeToggle(false)).toEqual({
      next: true,
      note: "Browser (--chrome) enabled for this chat — takes effect from your next message.",
    });
  });
  it("toggling OFF (from on) → disabled note + computerUse false", () => {
    expect(computeChromeToggle(true)).toEqual({
      next: false,
      note: "Browser (--chrome) disabled for this chat — takes effect from your next message.",
    });
  });
  it("the note always agrees with the returned next state (never the old one)", () => {
    for (const current of [true, false]) {
      const { next, note } = computeChromeToggle(current);
      expect(next).toBe(!current);
      expect(note).toBe(chromeToggleNote(next));
    }
  });
});
