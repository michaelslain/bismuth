// Tests for the pure opencode → ChatFrame translation (core/src/chatProviders/opencodeTranslate.ts)
// against event shapes captured from a live `opencode run --format json` (v1.17.15).
import { describe, expect, test } from "bun:test";
import {
  newOpencodeTurnState,
  opencodeTitleFromPrompt,
  parseOpencodeModels,
  translateOpencodeEvent,
  translateOpencodeExport,
} from "../../src/chatProviders/opencodeTranslate";
import { resolveChatProvider } from "../../src/chatProviders";

const SID = "ses_0ab633e24ffe05oTxes0rP0MZh";

function ev(type: string, part: Record<string, unknown>): unknown {
  return { type, timestamp: 1783830998470, sessionID: SID, part: { sessionID: SID, messageID: "msg_1", ...part } };
}

describe("translateOpencodeEvent", () => {
  test("text part → one assistant-text frame; session id captured", () => {
    const state = newOpencodeTurnState();
    const frames = translateOpencodeEvent(ev("text", { id: "prt_1", type: "text", text: "ok" }), state);
    expect(frames).toEqual([{ type: "assistant-text", text: "ok" }]);
    expect(state.sessionId).toBe(SID);
  });

  test("repeated part id with growing text emits only the suffix (streaming-tolerant)", () => {
    const state = newOpencodeTurnState();
    expect(translateOpencodeEvent(ev("text", { id: "p", type: "text", text: "Hel" }), state)).toEqual([
      { type: "assistant-text", text: "Hel" },
    ]);
    expect(translateOpencodeEvent(ev("text", { id: "p", type: "text", text: "Hello" }), state)).toEqual([
      { type: "assistant-text", text: "lo" },
    ]);
    // Same text again → nothing new.
    expect(translateOpencodeEvent(ev("text", { id: "p", type: "text", text: "Hello" }), state)).toEqual([]);
  });

  test("independent parts each emit their full text", () => {
    const state = newOpencodeTurnState();
    translateOpencodeEvent(ev("text", { id: "p1", type: "text", text: "one" }), state);
    expect(translateOpencodeEvent(ev("text", { id: "p2", type: "text", text: "two" }), state)).toEqual([
      { type: "assistant-text", text: "two" },
    ]);
  });

  test("reasoning part → thinking frame", () => {
    const state = newOpencodeTurnState();
    expect(translateOpencodeEvent(ev("reasoning", { id: "r1", type: "reasoning", text: "hmm" }), state)).toEqual([
      { type: "thinking", text: "hmm" },
    ]);
  });

  test("completed tool_use → tool-use + tool-result together (the live run shape)", () => {
    const state = newOpencodeTurnState();
    const frames = translateOpencodeEvent(
      ev("tool_use", {
        type: "tool",
        tool: "read",
        callID: "call_1",
        state: { status: "completed", input: { filePath: "/v" }, output: "note.md", title: "v" },
      }),
      state,
    );
    expect(frames).toEqual([
      { type: "tool-use", id: "call_1", name: "read", input: { filePath: "/v" } },
      { type: "tool-result", id: "call_1", content: "note.md", isError: false },
    ]);
  });

  test("pending tool_use emits only the chip; the later completed event resolves it once", () => {
    const state = newOpencodeTurnState();
    expect(
      translateOpencodeEvent(ev("tool_use", { type: "tool", tool: "bash", callID: "c", state: { status: "running", input: {} } }), state),
    ).toEqual([{ type: "tool-use", id: "c", name: "bash", input: {} }]);
    expect(
      translateOpencodeEvent(ev("tool_use", { type: "tool", tool: "bash", callID: "c", state: { status: "completed", input: {}, output: "hi" } }), state),
    ).toEqual([{ type: "tool-result", id: "c", content: "hi", isError: false }]);
    // A stray re-delivery neither re-opens the chip nor double-resolves it.
    expect(
      translateOpencodeEvent(ev("tool_use", { type: "tool", tool: "bash", callID: "c", state: { status: "completed", input: {}, output: "hi" } }), state),
    ).toEqual([]);
  });

  test("errored tool_use carries the error text and isError", () => {
    const state = newOpencodeTurnState();
    const frames = translateOpencodeEvent(
      ev("tool_use", { type: "tool", tool: "bash", callID: "c", state: { status: "error", input: {}, error: "boom" } }),
      state,
    );
    expect(frames[1]).toEqual({ type: "tool-result", id: "c", content: "boom", isError: true });
  });

  test("step_start/step_finish emit no frames; step_finish accumulates a nonzero cost", () => {
    const state = newOpencodeTurnState();
    expect(translateOpencodeEvent(ev("step_start", { type: "step-start" }), state)).toEqual([]);
    expect(translateOpencodeEvent(ev("step_finish", { type: "step-finish", reason: "stop", cost: 0 }), state)).toEqual([]);
    expect(state.costUsd).toBeNull(); // zero cost (subscription/free) stays hidden
    translateOpencodeEvent(ev("step_finish", { type: "step-finish", reason: "stop", cost: 0.01 }), state);
    translateOpencodeEvent(ev("step_finish", { type: "step-finish", reason: "stop", cost: 0.02 }), state);
    expect(state.costUsd).toBeCloseTo(0.03);
  });

  test("error event → error frame; malformed events never throw", () => {
    const state = newOpencodeTurnState();
    expect(translateOpencodeEvent({ type: "error", message: "rate limited" }, state)).toEqual([
      { type: "error", code: "error", message: "rate limited" },
    ]);
    expect(translateOpencodeEvent(null, state)).toEqual([]);
    expect(translateOpencodeEvent("garbage", state)).toEqual([]);
    expect(translateOpencodeEvent({ type: "text" }, state)).toEqual([]); // no part at all
  });
});

describe("translateOpencodeExport", () => {
  const exportDoc = {
    info: { id: SID, title: "List the files", version: "1.17.15" },
    messages: [
      {
        info: { role: "user", id: "m1" },
        parts: [{ type: "text", text: "<editor-context>\nActive file: a.md\n</editor-context>\n\nlist the files" }],
      },
      {
        info: { role: "assistant", id: "m2" },
        parts: [
          { type: "reasoning", text: "checking" },
          { type: "tool", tool: "read", callID: "call_1", state: { status: "completed", input: { p: 1 }, output: "note.md" } },
          { type: "text", text: "One file: note.md" },
          { type: "step-finish" },
        ],
      },
    ],
  };

  test("replays user prose (preamble stripped), thinking, tool chips + results, and prose in order", () => {
    const { title, frames } = translateOpencodeExport(exportDoc);
    expect(title).toBe("List the files");
    expect(frames).toEqual([
      { type: "user-message", text: "list the files" },
      { type: "thinking", text: "checking" },
      { type: "tool-use", id: "call_1", name: "read", input: { p: 1 } },
      { type: "tool-result", id: "call_1", content: "note.md", isError: false },
      { type: "assistant-text", text: "One file: note.md" },
    ]);
  });

  test("tolerates malformed exports", () => {
    expect(translateOpencodeExport(null)).toEqual({ title: null, frames: [] });
    expect(translateOpencodeExport({ info: {} })).toEqual({ title: null, frames: [] });
    expect(translateOpencodeExport({ messages: [{ info: { role: "user" } }] }).frames).toEqual([]);
  });
});

describe("parseOpencodeModels", () => {
  test("keeps provider/model lines, drops banner noise + duplicates, preserves order", () => {
    const out = parseOpencodeModels(
      ["", "opencode/gpt-5.2", "moonshotai/kimi-k2", "opencode/gpt-5.2", "not a model line", "  anthropic/claude-sonnet-4-5  "].join("\n"),
    );
    expect(out.map((m) => m.value)).toEqual(["opencode/gpt-5.2", "moonshotai/kimi-k2", "anthropic/claude-sonnet-4-5"]);
    // No effort discovery on opencode → empty levels, which hides the frontend Effort picker.
    expect(out.every((m) => m.effortLevels.length === 0)).toBe(true);
  });
});

describe("opencodeTitleFromPrompt", () => {
  test("strips the editor-context preamble, collapses whitespace, truncates with an ellipsis", () => {
    expect(opencodeTitleFromPrompt("<editor-context>\nActive file: a.md\n</editor-context>\n\nhello   world")).toBe("hello world");
    expect(opencodeTitleFromPrompt("x".repeat(100)).length).toBe(48);
    expect(opencodeTitleFromPrompt("x".repeat(100)).endsWith("…")).toBe(true);
    expect(opencodeTitleFromPrompt("   ")).toBe("");
  });
});

describe("resolveChatProvider", () => {
  test("requested wins when valid; falls back to the setting; bottoms out at claude", () => {
    expect(resolveChatProvider("opencode", "claude")).toBe("opencode");
    expect(resolveChatProvider("claude", "opencode")).toBe("claude");
    expect(resolveChatProvider(undefined, "opencode")).toBe("opencode");
    expect(resolveChatProvider("gpt-cli", "opencode")).toBe("opencode");
    expect(resolveChatProvider(undefined, undefined)).toBe("claude");
    expect(resolveChatProvider(42, "banana")).toBe("claude");
  });
});
