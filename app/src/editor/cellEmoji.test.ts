// Pure-logic tests for in-cell :emoji: autocomplete (editor/cellEmoji.ts, #49). The trigger
// detection + key decision are DOM-free, so they run under `bun test` with no browser. The DOM
// parts (replaceTokenBeforeCaret + the CellEmojiMenu controller) are exercised in tableWidget.test.ts,
// which already installs happy-dom.
import { test, expect, describe } from "bun:test";
import { emojiTokenBeforeCaret, emojiMenuKey } from "./cellEmoji";

describe("#49 emojiTokenBeforeCaret — the trigger (pure)", () => {
  test("a bare :query before the caret triggers, with the right tokenLen", () => {
    expect(emojiTokenBeforeCaret(":smi")).toEqual({ query: "smi", tokenLen: 4 }); // ":smi" = 4 chars
    expect(emojiTokenBeforeCaret(":fire")).toEqual({ query: "fire", tokenLen: 5 });
    expect(emojiTokenBeforeCaret(":")).toEqual({ query: "", tokenLen: 1 }); // lone colon → empty query (popular)
  });

  test("a :query after whitespace / mid-line triggers on the last token", () => {
    expect(emojiTokenBeforeCaret("hello :fire")).toEqual({ query: "fire", tokenLen: 5 });
    expect(emojiTokenBeforeCaret("- :ro")).toEqual({ query: "ro", tokenLen: 3 }); // in a list item
  });

  test("only the CURRENT line before the caret is considered", () => {
    expect(emojiTokenBeforeCaret("line one\n:smile")).toEqual({ query: "smile", tokenLen: 6 });
    // a token on a PRIOR line doesn't leak into the current (empty) line
    expect(emojiTokenBeforeCaret(":smile\n")).toBeNull();
  });

  test("a closing colon is part of the token (still replaceable)", () => {
    expect(emojiTokenBeforeCaret(":smile:")).toEqual({ query: "smile", tokenLen: 7 });
  });

  test("does NOT trigger where the editor's emoji source wouldn't (key:value, url, time)", () => {
    expect(emojiTokenBeforeCaret("key:value")).toBeNull(); // colon not at line-start/after-space
    expect(emojiTokenBeforeCaret("https://x")).toBeNull();
    expect(emojiTokenBeforeCaret("12:30")).toBeNull();
    expect(emojiTokenBeforeCaret("plain text")).toBeNull();
    expect(emojiTokenBeforeCaret("")).toBeNull();
  });

  test("a ZWSP filler before the token is ignored", () => {
    expect(emojiTokenBeforeCaret("​:fire")).toEqual({ query: "fire", tokenLen: 5 });
  });
});

describe("#49 emojiMenuKey — the key decision (pure)", () => {
  test("arrows navigate, Enter/Tab accept, Escape + caret-moves close", () => {
    expect(emojiMenuKey("ArrowDown")).toBe("next");
    expect(emojiMenuKey("ArrowUp")).toBe("prev");
    expect(emojiMenuKey("Enter")).toBe("accept");
    expect(emojiMenuKey("Tab")).toBe("accept");
    expect(emojiMenuKey("Escape")).toBe("close");
    expect(emojiMenuKey("ArrowLeft")).toBe("close");
    expect(emojiMenuKey("ArrowRight")).toBe("close");
    expect(emojiMenuKey("Home")).toBe("close");
    expect(emojiMenuKey("End")).toBe("close");
  });

  test("any character key falls through (null) so normal typing re-evaluates the menu", () => {
    expect(emojiMenuKey("a")).toBeNull();
    expect(emojiMenuKey("1")).toBeNull();
    expect(emojiMenuKey(":")).toBeNull();
    expect(emojiMenuKey("Backspace")).toBeNull();
  });
});
