// app/src/chatComposerKeys.test.ts
import { describe, it, expect } from "bun:test";
import { classifyComposerKey } from "./chatComposerKeys";

const idle = { slashOpen: false, streaming: false };

describe("classifyComposerKey", () => {
  it("Enter (no Shift) sends when idle", () => {
    expect(classifyComposerKey({ key: "Enter", shiftKey: false }, idle)).toBe("send");
  });

  it("Shift+Enter passes through to CodeMirror (a plain newline)", () => {
    expect(classifyComposerKey({ key: "Enter", shiftKey: true }, idle)).toBe("pass");
  });

  it("Enter still sends while a turn is streaming (mid-turn staging)", () => {
    expect(classifyComposerKey({ key: "Enter", shiftKey: false }, { slashOpen: false, streaming: true })).toBe("send");
  });

  it("Escape interrupts while streaming", () => {
    expect(classifyComposerKey({ key: "Escape", shiftKey: false }, { slashOpen: false, streaming: true })).toBe("stop");
  });

  it("Escape does nothing (passes) when not streaming and no popover", () => {
    expect(classifyComposerKey({ key: "Escape", shiftKey: false }, idle)).toBe("pass");
  });

  it("ordinary typing passes through", () => {
    expect(classifyComposerKey({ key: "a", shiftKey: false }, idle)).toBe("pass");
    expect(classifyComposerKey({ key: "ArrowDown", shiftKey: false }, idle)).toBe("pass");
  });

  describe("prompt history (arrow keys at a boundary)", () => {
    it("ArrowUp at the top boundary recalls history", () => {
      expect(classifyComposerKey({ key: "ArrowUp", shiftKey: false }, { ...idle, atTop: true })).toBe("history-up");
    });
    it("ArrowUp NOT at the top boundary passes through (ordinary multi-line movement)", () => {
      expect(classifyComposerKey({ key: "ArrowUp", shiftKey: false }, { ...idle, atTop: false })).toBe("pass");
    });
    it("ArrowDown at the bottom boundary moves toward the newest / draft", () => {
      expect(classifyComposerKey({ key: "ArrowDown", shiftKey: false }, { ...idle, atBottom: true })).toBe("history-down");
    });
    it("ArrowDown NOT at the bottom boundary passes through", () => {
      expect(classifyComposerKey({ key: "ArrowDown", shiftKey: false }, { ...idle, atBottom: false })).toBe("pass");
    });
    it("the slash popover still wins over history recall when open", () => {
      expect(classifyComposerKey({ key: "ArrowUp", shiftKey: false }, { slashOpen: true, streaming: false, atTop: true })).toBe(
        "slash-nav",
      );
      expect(
        classifyComposerKey({ key: "ArrowDown", shiftKey: false }, { slashOpen: true, streaming: false, atBottom: true }),
      ).toBe("slash-nav");
    });
  });

  describe("slash popover open", () => {
    const slash = { slashOpen: true, streaming: false };
    it("Arrow keys navigate the menu", () => {
      expect(classifyComposerKey({ key: "ArrowDown", shiftKey: false }, slash)).toBe("slash-nav");
      expect(classifyComposerKey({ key: "ArrowUp", shiftKey: false }, slash)).toBe("slash-nav");
    });
    it("Escape closes the menu (nav), not a stop", () => {
      expect(classifyComposerKey({ key: "Escape", shiftKey: false }, slash)).toBe("slash-nav");
    });
    it("Escape closes the menu even while streaming (popover wins over stop)", () => {
      expect(classifyComposerKey({ key: "Escape", shiftKey: false }, { slashOpen: true, streaming: true })).toBe("slash-nav");
    });
    it("Enter picks the highlighted command", () => {
      expect(classifyComposerKey({ key: "Enter", shiftKey: false }, slash)).toBe("slash-select");
    });
    it("Shift+Enter still passes (newline) even with the popover open", () => {
      expect(classifyComposerKey({ key: "Enter", shiftKey: true }, slash)).toBe("pass");
    });
    it("ordinary typing passes so the query keeps updating", () => {
      expect(classifyComposerKey({ key: "x", shiftKey: false }, slash)).toBe("pass");
    });
  });
});
