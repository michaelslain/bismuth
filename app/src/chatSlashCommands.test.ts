// app/src/chatSlashCommands.test.ts
import { describe, it, expect } from "bun:test";
import { parseChatSlashCommand, CLIENT_SLASH_COMMANDS, withClientSlashCommands, chromeToggleNote, computeChromeToggle, computeChromeCommand } from "./chatSlashCommands";

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
  it("parses a bare `/chrome` with an empty arg", () => {
    expect(parseChatSlashCommand("/chrome")).toEqual({ kind: "chrome", arg: "" });
  });
  it("is case-insensitive on `/chrome`", () => {
    expect(parseChatSlashCommand("/CHROME")).toEqual({ kind: "chrome", arg: "" });
    expect(parseChatSlashCommand("/Chrome")).toEqual({ kind: "chrome", arg: "" });
  });
  it("trims whitespace around `/chrome`", () => {
    expect(parseChatSlashCommand("  /chrome  ")).toEqual({ kind: "chrome", arg: "" });
  });
  // BUG #87 bounce 3: the arg is CAPTURED now (it used to be dropped, leaving the user no way to say
  // which direction they wanted — the command could only ever flip whatever state it found).
  it("captures the `/chrome` argument so on/off can be asked for explicitly", () => {
    expect(parseChatSlashCommand("/chrome on")).toEqual({ kind: "chrome", arg: "on" });
    expect(parseChatSlashCommand("/chrome off")).toEqual({ kind: "chrome", arg: "off" });
    expect(parseChatSlashCommand("  /chrome   OFF  ")).toEqual({ kind: "chrome", arg: "OFF" });
    expect(parseChatSlashCommand("/chrome foo")).toEqual({ kind: "chrome", arg: "foo" });
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

// BUG #87 RE-FIX: the Globe PILL's flip + its transcript note must stay in lockstep — turning
// --chrome ON (from OFF) yields the ENABLED note AND the new state `true`; turning it OFF yields the
// disabled note AND `false`. The message reflects the NEW state, never the pre-toggle one. A pill
// renders the state it's about to flip, so toggle semantics are correct here (the `/chrome` COMMAND
// is a different mapping — see computeChromeCommand below).
describe("computeChromeToggle (Globe pill: new-state ⇄ message mapping)", () => {
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

// BUG #87, BOUNCE 3 — the root cause and the regression that pins it.
//
// The user's report, three times over: typing `/chrome` answers "Browser (--chrome) disabled for this
// chat". `/chrome` is an ENABLE verb (its card: "/chrome turns on browser/computer-use"; it mirrors
// the `--chrome` CLI flag), but it was implemented as a blind toggle — `next = !current` — so its
// answer depended on hidden prior state. Whenever the chat was ALREADY on, the enable verb DISABLED
// the browser and honestly reported "disabled". A user who wants the browser is precisely the user
// whose chats are already on (their vault sets `chat.computerUse: true`, or they enabled it once).
//
// The two earlier fixes only changed which state the toggle STARTS from (seed from the global; then
// hardcode false). Neither could work: for ANY starting default, "already on" is reachable — via the
// pill, via a second `/chrome`, via the vault's own setting — and there the enable verb still
// disables. The fix is at the SEMANTIC layer: the command no longer toggles.
describe("computeChromeCommand (BUG #87 bounce 3: /chrome is an ENABLE verb, not a toggle)", () => {
  // THE BOUNCE. Against the old blind-toggle code this returned the user's exact sentence.
  it("a bare `/chrome` on an ALREADY-ENABLED chat still reads enabled — never 'disabled'", () => {
    expect(computeChromeCommand(true, "")).toEqual({
      next: true, // stays ON: an enable verb must not turn the browser off
      note: "Browser (--chrome) is already enabled for this chat.",
    });
  });
  // Direction 1 of the required both-directions coverage: off -> on prints "enabled".
  it("a bare `/chrome` on a disabled chat ENABLES it (off → on prints enabled)", () => {
    expect(computeChromeCommand(false, "")).toEqual({
      next: true,
      note: "Browser (--chrome) enabled for this chat — takes effect from your next message.",
    });
  });
  // Direction 2: on -> off prints "disabled" — but ONLY when explicitly asked for.
  it("`/chrome off` on an enabled chat DISABLES it (on → off prints disabled)", () => {
    expect(computeChromeCommand(true, "off")).toEqual({
      next: false,
      note: "Browser (--chrome) disabled for this chat — takes effect from your next message.",
    });
  });
  it("`/chrome off` on an already-disabled chat stays off and says so without promising an effect", () => {
    expect(computeChromeCommand(false, "off")).toEqual({
      next: false,
      note: "Browser (--chrome) is already disabled for this chat.",
    });
  });
  it("accepts explicit on/enable/disable, case- and space-insensitively", () => {
    expect(computeChromeCommand(false, "on")?.next).toBe(true);
    expect(computeChromeCommand(false, "ON")?.next).toBe(true);
    expect(computeChromeCommand(false, "enable")?.next).toBe(true);
    expect(computeChromeCommand(true, "OFF")?.next).toBe(false);
    expect(computeChromeCommand(true, " disable ")?.next).toBe(false);
  });
  // The invariant that makes the bounce unrepeatable, checked over EVERY starting state: no matter
  // what the chat's hidden prior state is, a bare `/chrome` ends enabled and never says "disabled".
  // This is the property both earlier fixes lacked — each only held for one particular start state.
  it("INVARIANT: from ANY prior state, `/chrome`/`/chrome on` ends enabled and never reports disabled", () => {
    for (const current of [true, false]) {
      for (const arg of ["", "on", "ON", "enable"]) {
        const out = computeChromeCommand(current, arg)!;
        expect(out.next).toBe(true);
        expect(out.note).toContain("enabled");
        expect(out.note).not.toContain("disabled");
      }
    }
  });
  // Only an explicit "off" can produce the word the user kept seeing.
  it("INVARIANT: only an explicit off/disable can report 'disabled'", () => {
    for (const current of [true, false]) {
      expect(computeChromeCommand(current, "off")!.note).toContain("disabled");
      expect(computeChromeCommand(current, "disable")!.note).toContain("disabled");
    }
  });
  it("returns undefined for an argument it won't guess at (caller reports it, like /color)", () => {
    expect(computeChromeCommand(false, "foo")).toBeUndefined();
    expect(computeChromeCommand(true, "yes")).toBeUndefined();
  });
});
