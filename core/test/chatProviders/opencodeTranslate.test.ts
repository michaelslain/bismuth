// Tests for the pure opencode → ChatFrame translation (core/src/chatProviders/opencodeTranslate.ts)
// against event shapes captured from a live `opencode run --format json` (v1.17.15).
import { describe, expect, test } from "bun:test";
import {
  newOpencodeTurnState,
  opencodeErrorMessage,
  opencodeTitleFromPrompt,
  OPENCODE_BUILTIN_COMMANDS,
  parseOpencodeAuthList,
  parseOpencodeDebugConfigCommands,
  parseOpencodeModels,
  parseOpencodeModelsVerbose,
  parseOpencodeRunCommand,
  pickZenFreeModel,
  translateOpencodeEvent,
  translateOpencodeExport,
  withOpencodeBuiltinCommands,
  withZenFreeRotate,
  zenFreeModelIds,
  ZEN_FREE_ROTATE_ID,
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

// ── RE-FIX #90: commands / auth / Zen free rotation ──────────────────────────────────────────────

// A trimmed `opencode debug config` capture (1.17.15): resolved config JSON on stdout whose
// `command` key merges config-file AND plugin-registered commands.
const DEBUG_CONFIG = JSON.stringify(
  {
    $schema: "https://opencode.ai/config.json",
    plugin: ["oh-my-opencode-slim"],
    command: {
      interview: { template: "Start an interview and write a live markdown spec", description: "Open a localhost interview UI" },
      deepwork: { template: "Start a deepwork session for a complex coding task" },
      preset: { template: "List available presets and switch between them", description: "Switch agent presets at runtime" },
    },
    lsp: true,
  },
  null,
  2,
);

describe("parseOpencodeDebugConfigCommands", () => {
  test("extracts the command map; description wins, template's first line stands in", () => {
    const cmds = parseOpencodeDebugConfigCommands(DEBUG_CONFIG);
    expect(cmds).toEqual([
      { name: "interview", description: "Open a localhost interview UI" },
      { name: "deepwork", description: "Start a deepwork session for a complex coding task" },
      { name: "preset", description: "Switch agent presets at runtime" },
    ]);
  });

  test("tolerates banner noise around the JSON", () => {
    const cmds = parseOpencodeDebugConfigCommands(`some log line\n${DEBUG_CONFIG}`);
    expect(cmds.map((c) => c.name)).toEqual(["interview", "deepwork", "preset"]);
  });

  test("degenerate inputs yield [] (no command key / malformed JSON / not JSON at all)", () => {
    expect(parseOpencodeDebugConfigCommands("{}")).toEqual([]);
    expect(parseOpencodeDebugConfigCommands('{"command": []}')).toEqual([]);
    expect(parseOpencodeDebugConfigCommands("{ nope")).toEqual([]);
    expect(parseOpencodeDebugConfigCommands("")).toEqual([]);
  });

  test("skips command names that can't be typed as one /token", () => {
    expect(parseOpencodeDebugConfigCommands('{"command": {"has space": {"template": "x"}, "ok": {"template": "y"}}}')).toEqual([
      { name: "ok", description: "y" },
    ]);
  });
});

describe("withOpencodeBuiltinCommands", () => {
  test("appends /init and /review after the user's own commands", () => {
    const merged = withOpencodeBuiltinCommands([{ name: "deepwork", description: "d" }]);
    expect(merged.map((c) => c.name)).toEqual(["deepwork", "init", "review"]);
  });

  test("a same-named custom command overrides the built-in (opencode's documented precedence)", () => {
    const merged = withOpencodeBuiltinCommands([{ name: "init", description: "my own init" }]);
    expect(merged).toEqual([{ name: "init", description: "my own init" }, OPENCODE_BUILTIN_COMMANDS[1]]);
  });

  test("bare list = just the built-ins (a config-less install still offers /init + /review)", () => {
    expect(withOpencodeBuiltinCommands([]).map((c) => c.name)).toEqual(["init", "review"]);
  });
});

describe("parseOpencodeRunCommand", () => {
  const NAMES = ["init", "review", "deepwork"];

  test("a leading /known-command splits into command + args", () => {
    expect(parseOpencodeRunCommand("/init focus on the CLI", NAMES)).toEqual({ command: "init", args: "focus on the CLI" });
    expect(parseOpencodeRunCommand("/review", NAMES)).toEqual({ command: "review", args: "" });
    expect(parseOpencodeRunCommand("  /deepwork  refactor the parser ", NAMES)).toEqual({ command: "deepwork", args: "refactor the parser" });
  });

  test("unknown /word, plain prose, and a bare slash flow through as prompts (null)", () => {
    expect(parseOpencodeRunCommand("/unknown thing", NAMES)).toBeNull();
    expect(parseOpencodeRunCommand("just some prose", NAMES)).toBeNull();
    expect(parseOpencodeRunCommand("/", NAMES)).toBeNull();
    expect(parseOpencodeRunCommand("/init", [])).toBeNull();
  });

  test("case-sensitive: command names are exact registry keys", () => {
    expect(parseOpencodeRunCommand("/Init", NAMES)).toBeNull();
  });
});

describe("parseOpencodeAuthList", () => {
  // Byte-accurate capture of `opencode auth list` (1.17.15): clack chrome + dim ANSI before the
  // credential kind.
  const AUTH_OUT = [
    "\x1b[0m",
    "┌  Credentials \x1b[90m~/.local/share/opencode/auth.json",
    "│",
    "●  Moonshot AI \x1b[90mapi",
    "│",
    "●  OpenCode Zen \x1b[90mapi",
    "│",
    "└  2 credentials",
    "",
  ].join("\n");

  test("parses provider names + credential kinds off the live output", () => {
    expect(parseOpencodeAuthList(AUTH_OUT)).toEqual([
      { name: "Moonshot AI", kind: "api" },
      { name: "OpenCode Zen", kind: "api" },
    ]);
  });

  test("no credentials / garbage / empty → []", () => {
    expect(parseOpencodeAuthList("┌  Credentials\n└  0 credentials\n")).toEqual([]);
    expect(parseOpencodeAuthList("")).toEqual([]);
    expect(parseOpencodeAuthList("random text\nwithout bullets")).toEqual([]);
  });

  test("colorless output falls back to the last-token split", () => {
    expect(parseOpencodeAuthList("●  Moonshot AI api\n")).toEqual([{ name: "Moonshot AI", kind: "api" }]);
    expect(parseOpencodeAuthList("●  Anthropic oauth\n")).toEqual([{ name: "Anthropic", kind: "oauth" }]);
  });
});

describe("Zen free-model rotation", () => {
  const MODELS = [
    { value: "opencode/big-pickle", label: "Big Pickle", description: "opencode/big-pickle", effortLevels: [], free: true },
    { value: "opencode/claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "opencode/claude-sonnet-4-6", effortLevels: [], free: false },
    { value: "opencode/hy3-free", label: "HY3 Free", description: "opencode/hy3-free", effortLevels: [], free: true },
    { value: "moonshotai/kimi-k2.5", label: "Kimi K2.5", description: "moonshotai/kimi-k2.5", effortLevels: [], free: true },
    { value: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", description: "anthropic/claude-opus-4-8", effortLevels: [] },
  ];

  test("zenFreeModelIds: only $0 Zen (opencode/…) models, order preserved", () => {
    // moonshotai's free model is NOT Zen; the badge-less anthropic model is unknown, not free.
    expect(zenFreeModelIds(MODELS)).toEqual(["opencode/big-pickle", "opencode/hy3-free"]);
  });

  test("withZenFreeRotate prepends the virtual rotating entry, marked free", () => {
    const out = withZenFreeRotate(MODELS);
    expect(out.length).toBe(MODELS.length + 1);
    expect(out[0].value).toBe(ZEN_FREE_ROTATE_ID);
    expect(out[0].free).toBe(true);
    expect(out[0].label).toContain("Zen Free");
    expect(out.slice(1)).toEqual(MODELS);
  });

  test("withZenFreeRotate is a no-op when Zen offers no free models", () => {
    const paidOnly = MODELS.filter((m) => m.free !== true);
    expect(withZenFreeRotate(paidOnly)).toEqual(paidOnly);
    expect(withZenFreeRotate([])).toEqual([]);
  });

  test("pickZenFreeModel round-robins per turn and survives an empty roster", () => {
    const free = ["opencode/a", "opencode/b", "opencode/c"];
    expect(pickZenFreeModel(free, 0)).toBe("opencode/a");
    expect(pickZenFreeModel(free, 1)).toBe("opencode/b");
    expect(pickZenFreeModel(free, 2)).toBe("opencode/c");
    expect(pickZenFreeModel(free, 3)).toBe("opencode/a");
    expect(pickZenFreeModel([], 5)).toBeNull();
  });

  test("the virtual id looks like provider/model (setModel's shape check must accept it)", () => {
    expect(/^[\w.-]+\/[\w.:-]+$/.test(ZEN_FREE_ROTATE_ID)).toBe(true);
  });
});
