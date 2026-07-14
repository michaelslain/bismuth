// Tests for the pure opencode → ChatFrame translation (core/src/chatProviders/opencodeTranslate.ts)
// against event shapes captured from a live `opencode run --format json` (v1.17.15).
import { describe, expect, test } from "bun:test";
import {
  newOpencodeTurnState,
  opencodeErrorMessage,
  opencodeTitleFromPrompt,
  parseOpencodeModels,
  parseOpencodeModelsVerbose,
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

  test("real API error (message nested under error.data) surfaces its actual message", () => {
    // Captured live (1.17.15): a Zen 401 arrives with the message on error.data, NOT the event.
    const state = newOpencodeTurnState();
    const frames = translateOpencodeEvent(
      {
        type: "error",
        timestamp: 1784005472272,
        sessionID: SID,
        error: { name: "APIError", data: { message: "Unauthorized: no payment method", statusCode: 401, isRetryable: false } },
      },
      state,
    );
    expect(frames).toEqual([{ type: "error", code: "error", message: "Unauthorized: no payment method" }]);
  });
});

describe("opencodeErrorMessage", () => {
  test("shallowest message wins; error.name backs a message-less error; generic bottom", () => {
    expect(opencodeErrorMessage({ message: "top" })).toBe("top");
    expect(opencodeErrorMessage({ error: { message: "mid" } })).toBe("mid");
    expect(opencodeErrorMessage({ error: { data: { message: "deep" } } })).toBe("deep");
    expect(opencodeErrorMessage({ error: { name: "APIError", data: {} } })).toBe("opencode reported an error (APIError)");
    expect(opencodeErrorMessage({})).toBe("opencode reported an error");
    expect(opencodeErrorMessage({ error: "string-error" })).toBe("opencode reported an error");
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

describe("parseOpencodeModelsVerbose", () => {
  // Mirrors real `opencode models --verbose` output (1.17.15): a column-0 id line, then a
  // pretty-printed JSON metadata block whose inner lines are indented.
  const block = (id: string, meta: Record<string, unknown>) => `${id}\n${JSON.stringify(meta, null, 2)}\n`;
  const fixture = [
    "some banner noise\n",
    block("opencode/big-pickle", { id: "big-pickle", providerID: "opencode", name: "Big Pickle", cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } }),
    block("opencode/claude-sonnet-4-6", { id: "claude-sonnet-4-6", providerID: "opencode", name: "Claude Sonnet 4.6", cost: { input: 3, output: 15 } }),
    block("opencode/kimi-k2.5", { id: "kimi-k2.5", providerID: "opencode", name: "Kimi K2.5", cost: { input: 0.6, output: 2.5 } }),
    block("moonshotai/kimi-k2.5", { id: "kimi-k2.5", providerID: "moonshotai", name: "Kimi K2.5", cost: { input: 0.6, output: 2.5 } }),
    "broken/model\nnot json at all\n",
  ].join("");

  test("classifies free vs paid off cost metadata and uses display names as labels", () => {
    const out = parseOpencodeModelsVerbose(fixture);
    expect(out.find((m) => m.value === "opencode/big-pickle")).toEqual({
      value: "opencode/big-pickle",
      label: "Big Pickle",
      description: "opencode/big-pickle",
      effortLevels: [],
      free: true,
    });
    expect(out.find((m) => m.value === "opencode/claude-sonnet-4-6")?.free).toBe(false);
    expect(out.find((m) => m.value === "opencode/claude-sonnet-4-6")?.label).toBe("Claude Sonnet 4.6");
  });

  test("disambiguates display-name collisions across providers", () => {
    const out = parseOpencodeModelsVerbose(fixture);
    expect(out.find((m) => m.value === "opencode/kimi-k2.5")?.label).toBe("Kimi K2.5 (opencode)");
    expect(out.find((m) => m.value === "moonshotai/kimi-k2.5")?.label).toBe("Kimi K2.5 (moonshotai)");
  });

  test("a malformed metadata block degrades to the bare id with NO badge (free undefined)", () => {
    const broken = parseOpencodeModelsVerbose(fixture).find((m) => m.value === "broken/model");
    expect(broken).toEqual({ value: "broken/model", label: "broken/model", description: "broken/model", effortLevels: [] });
    expect(broken && "free" in broken).toBe(false);
  });

  test("returns [] on output with no model ids (caller falls back to the plain list)", () => {
    expect(parseOpencodeModelsVerbose("")).toEqual([]);
    expect(parseOpencodeModelsVerbose("usage: opencode models [provider]\n")).toEqual([]);
  });

  test("drops duplicate ids, preserves order", () => {
    const out = parseOpencodeModelsVerbose(fixture + block("opencode/big-pickle", { name: "Dup" }));
    expect(out.filter((m) => m.value === "opencode/big-pickle")).toHaveLength(1);
    expect(out[0].value).toBe("opencode/big-pickle");
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
