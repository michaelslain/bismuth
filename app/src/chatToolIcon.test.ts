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
import { GENERIC_TOOL_ICON, chipSummary, clamp, pickToolIcon, toolIcon } from "./chatToolIcon";

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

describe("chipSummary (the label-echo rule)", () => {
  // THE REGRESSION THIS GUARDS. toolCallInput() carries an ACP ToolCall's `title` into the input as
  // `description`, and summarizeInput() picks `description` — the only key present when the call
  // has no arguments of its own. Once the chip is ALSO labelled by `title`, both halves are the
  // same string and the chip reads "Write foo.txt — Write foo.txt".
  const TITLE = "Write fake-permission-probe.txt";

  test("suppresses a summary that merely repeats the chip's label", () => {
    expect(chipSummary(TITLE, TITLE, 120)).toBe("");
  });

  test("keeps a summary that says something the label does not", () => {
    // The Claude/opencode/codex case, and the ACP case where the agent sent a real parameter:
    // suppression must be exact, not "anything that resembles the name".
    expect(chipSummary("/etc/hosts", "Read", 120)).toBe("/etc/hosts");
    expect(chipSummary("Write foo.txt", "Write bar.txt", 120)).toBe("Write foo.txt");
    // The rule is EXACT equality, not containment, in both directions. These two cases are the
    // reason: a summary that merely CONTAINS the label still carries the extra half, and a summary
    // CONTAINED BY the label is a different (shorter) string the user has not otherwise seen.
    // Written after a sabotage run: an earlier version of this test used strings that were not
    // actually substrings of each other, so a containment-based rule passed it. It no longer does.
    expect(chipSummary(`${TITLE} (dry run)`, TITLE, 120)).toBe(`${TITLE} (dry run)`);
    expect(chipSummary("fake-permission-probe.txt", TITLE, 120)).toBe("fake-permission-probe.txt");
  });

  test("dedups on the RAW text, before clamping — the ordering the function exists to pin", () => {
    // `max` well below the label's length: if the clamp ran first, the summary would come back as
    // "Write fake…" — no longer equal to the name — and the echo would survive exactly when the
    // chip is most cluttered. This is the one assertion that distinguishes the two orderings.
    expect(chipSummary(TITLE, TITLE, 10)).toBe("");
    // …and clamping still happens for text that ISN'T an echo, so the guard did not disable it.
    expect(chipSummary(TITLE, "Read", 10)).toBe("Write fake…");
  });

  test("tolerates the whitespace summarizeInput would already have trimmed", () => {
    expect(chipSummary(`  ${TITLE}  `, TITLE, 120)).toBe("");
  });

  test("clamp itself: under the cap is untouched, over it gains a single ellipsis", () => {
    expect(clamp("short", 10)).toBe("short");
    expect(clamp("0123456789", 10)).toBe("0123456789"); // exactly at the cap — no ellipsis
    expect(clamp("0123456789x", 10)).toBe("0123456789…");
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

  /** Every source line containing `needle`, joined — never the whole file. Asserting against
   *  `chatView` directly works, but a FAILURE then dumps all ~143 KB of ChatView.tsx into the test
   *  output and buries the actual diff. Narrowing to the matching lines keeps the guard and loses
   *  the noise; an unmatched needle yields "", which fails just as loudly. */
  const linesWith = (needle: string): string =>
    chatView
      .split("\n")
      .filter((l) => l.includes(needle))
      .join("\n");

  test("the chip's icon is chosen from the part's kind AND name, not the name alone", () => {
    expect(linesWith("pickToolIcon(")).toContain("pickToolIcon(p.part.toolKind, p.part.name)");
  });

  test("the tool part carries the frame's `kind` through as `toolKind`", () => {
    // Without this line pickToolIcon would always receive undefined and the icon rule would be
    // permanently inert — the exact failure mode a rule-only test cannot see.
    expect(linesWith("toolKind:")).toContain("toolKind: frame.kind");
  });

  test("both summary surfaces dedup against their own label, with their own cap", () => {
    // The tool chip (120) and the permission card (160). The second is a PRE-EXISTING echo rather
    // than one this change introduced — driver.ts already named permissions by `title` — but it is
    // the same rule, so it is pinned the same way.
    const calls = linesWith("chipSummary(");
    expect(calls).toContain("chipSummary(summarizeInput(p.part.input), p.part.name, 120)");
    expect(calls).toContain("chipSummary(summarizeInput(p.part.input), p.part.toolName, 160)");
  });
});
