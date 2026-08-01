// app/src/chatToolIcon.test.ts
//
// WHY THIS FILE EXISTS. core/test/chatProviders/acpPermissionFakeAgent.test.ts proves the two ACP
// surfaces now name a ToolCall identically and that `kind` reaches the frame. It cannot prove the
// frontend does anything with `kind`, and there was no frontend test for the icon at all — so
// reverting the ChatView side of that change would have failed nothing. These assertions close
// exactly that hole: they are about the RULE, not about a rendered chip.
//
// Every expectation below names an absolute Lucide icon ("Pencil", "Wrench") rather than comparing
// two calls to the function under test against each other, so none of them can be satisfied by the
// rule being uniformly wrong.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERIC_TOOL_ICON, pickToolIcon, toolIcon } from "./chatToolIcon";

describe("toolIcon (single-string matcher)", () => {
  test("matches Claude Code tool names case-insensitively", () => {
    expect(toolIcon("Bash")).toBe("SquareTerminal");
    expect(toolIcon("Read")).toBe("FileText");
    expect(toolIcon("Edit")).toBe("Pencil");
    expect(toolIcon("Grep")).toBe("Search");
    expect(toolIcon("WebFetch")).toBe("Globe");
    expect(toolIcon("Task")).toBe("Bot");
    expect(toolIcon("todo")).toBe("LayoutList");
    expect(toolIcon("mcp__bismuth__bismuth_cli")).toBe("Server");
  });

  // PRE-EXISTING, characterized not endorsed, and deliberately NOT fixed here: the rules are ordered
  // and `write` is tested before `todo`, so Claude Code's actual tool name lands on the pencil and
  // the LayoutList rule above is only reachable by names that avoid every earlier rule. Reordering
  // would change a Claude-backend icon, which has nothing to do with the ACP naming fix this module
  // was extracted for. Recorded here so the next person meets it as a fact rather than a surprise.
  test("rule order shadows `todo` behind `write` (pre-existing)", () => {
    expect(toolIcon("TodoWrite")).toBe("Pencil");
  });

  test("an unrecognized string gets the generic icon", () => {
    expect(toolIcon("Update the configuration")).toBe("Wrench");
    expect(GENERIC_TOOL_ICON).toBe("Wrench");
  });
});

describe("pickToolIcon (the ACP title-vs-kind rule)", () => {
  // THE REGRESSION THIS GUARDS. ACP tool chips are labelled by `title` — free-form prose. A title
  // that happens to contain a known verb still matches; one that doesn't would have fallen to a
  // wrench if `kind` were ignored. Both halves are asserted, because only the pair shows that the
  // second case is `kind` doing work rather than the title having matched anyway.
  test("an informative `kind` rescues a title that matches nothing", () => {
    expect(toolIcon("Update the configuration")).toBe("Wrench"); // the title alone: no match
    expect(pickToolIcon("edit", "Update the configuration")).toBe("Pencil"); // …with `kind`: correct
  });

  test("`kind` outranks the title even when the title WOULD have matched something else", () => {
    // Not merely "kind is consulted": here the two strings disagree, so the assertion can only pass
    // if kind actually wins. ("Search the read-only mirror" matches `read` → FileText on its own.)
    expect(toolIcon("Search the read-only mirror")).toBe("FileText");
    expect(pickToolIcon("search", "Search the read-only mirror")).toBe("Search");
  });

  test("a `kind` this table has no rule for defers to the title instead of forcing a wrench", () => {
    // "other" is the DEFAULT value of ACP's ToolKind enum, so agents send it constantly; the same
    // holds for "execute"/"delete"/"move"/"think"/"switch_mode". Taking `kind` unconditionally
    // would pin all of them to the generic icon even with a perfectly readable title.
    expect(toolIcon("other")).toBe("Wrench"); // no rule — the premise of the next two lines
    expect(pickToolIcon("other", "Read foo.ts")).toBe("FileText");
    expect(pickToolIcon("switch_mode", "Write the summary")).toBe("Pencil");
  });

  test("no `kind` at all (Claude / opencode / codex frames) behaves exactly like the old name-only rule", () => {
    expect(pickToolIcon(undefined, "Bash")).toBe("SquareTerminal");
    expect(pickToolIcon(undefined, "Update the configuration")).toBe("Wrench");
    expect(pickToolIcon("", "Read")).toBe("FileText"); // empty string is absence, not a lookup
  });

  test("the generic icon survives only when NEITHER string matched", () => {
    expect(pickToolIcon("other", "Update the configuration")).toBe("Wrench");
  });
});

// ── The WIRING, and an honest note about how strong this is ─────────────────────────────────────
// Everything above tests the rule in isolation. The rule is worthless if ChatView never feeds it
// `kind`, and nothing in this repo mounts ChatView.tsx in a test — so without the two assertions
// below, deleting the ChatView half of this change would break the feature and fail NOTHING.
//
// These are SOURCE-TEXT assertions (the same technique as PaneContent.settings.test.ts and
// Terminal.cleanup.test.ts), and their limit should be stated rather than glossed: they prove the
// two call sites are written as intended, NOT that a rendered chip shows the right icon. A
// behavioral test would have to mount a Solid component, which nothing here does. Treat this as a
// structural guard against the wiring being silently removed, and nothing more.
describe("ChatView wiring (source-text guard — see the note above for what this does and does not prove)", () => {
  const chatView = readFileSync(join(import.meta.dir, "ChatView.tsx"), "utf8");

  test("the chip's icon is chosen from the part's kind AND name, not the name alone", () => {
    expect(chatView).toContain("pickToolIcon(p.part.toolKind, p.part.name)");
  });

  test("the tool part carries the frame's `kind` through as `toolKind`", () => {
    // Without this line pickToolIcon would always receive undefined and the rule above would be
    // permanently inert — the exact failure mode a rule-only test cannot see.
    expect(chatView).toContain("toolKind: frame.kind");
  });
});
