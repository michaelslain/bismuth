// Tests for the pure ACP (Agent Client Protocol) translation + JSON-RPC plumbing
// (core/src/chatProviders/acp/protocol.ts) against shapes verified in the ACP research report
// (grepped against @agentclientprotocol/sdk@1.3.0's generated .d.ts, plus the still-current
// claude-code-acp adapter pinned to sdk 0.14.1 — the version-skew case). No ACP agent binary is
// spawned here — see ./driver.ts for the effectful half, which is untested for the same reason
// core/src/chatProviders/opencode.ts is untested (only its pure translate module has a test file).
import { describe, expect, test } from "bun:test";
import {
  AcpRpcError,
  choosePermissionOption,
  contentBlockText,
  createIdMinter,
  detectModelShape,
  encodeJsonRpcError,
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  encodeJsonRpcResult,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isMethodNotFoundError,
  newAcpTranslateState,
  parseJsonRpcLine,
  toolCallContentText,
  toolCallInput,
  toolCallName,
  translateSessionUpdate,
  type AcpManifestBaseline,
} from "../../src/chatProviders/acp/protocol";

function blankManifest(): AcpManifestBaseline {
  return { model: "", permissionMode: "default", tools: [], mcpServers: [], slashCommands: [], commandDetails: {} };
}

// ── JSON-RPC envelope ─────────────────────────────────────────────────────────────────────────

describe("parseJsonRpcLine", () => {
  test("parses a request/notification/response line, trimming whitespace", () => {
    expect(parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    expect(parseJsonRpcLine('  {"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s1"}}  ')).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    });
  });

  test("blank lines, non-JSON noise, and non-2.0 envelopes all yield null", () => {
    expect(parseJsonRpcLine("")).toBeNull();
    expect(parseJsonRpcLine("   \n")).toBeNull();
    expect(parseJsonRpcLine("not json at all")).toBeNull();
    expect(parseJsonRpcLine('{"hello":"world"}')).toBeNull();
    expect(parseJsonRpcLine('{"jsonrpc":"1.0","id":1,"method":"x"}')).toBeNull();
    expect(parseJsonRpcLine("[1,2,3]")).toBeNull();
    expect(parseJsonRpcLine("null")).toBeNull();
  });
});

describe("isJsonRpcRequest / isJsonRpcNotification / isJsonRpcResponse", () => {
  const request = { jsonrpc: "2.0" as const, id: 1, method: "session/request_permission", params: {} };
  const notification = { jsonrpc: "2.0" as const, method: "session/update", params: {} };
  const success = { jsonrpc: "2.0" as const, id: 1, result: { stopReason: "end_turn" } };
  const failure = { jsonrpc: "2.0" as const, id: 1, error: { code: -32601, message: "not found" } };

  test("a request has both method and id", () => {
    expect(isJsonRpcRequest(request)).toBe(true);
    expect(isJsonRpcNotification(request)).toBe(false);
    expect(isJsonRpcResponse(request)).toBe(false);
  });

  test("a notification has method but no id", () => {
    expect(isJsonRpcNotification(notification)).toBe(true);
    expect(isJsonRpcRequest(notification)).toBe(false);
    expect(isJsonRpcResponse(notification)).toBe(false);
  });

  test("success/error responses have id + result/error, no method", () => {
    expect(isJsonRpcResponse(success)).toBe(true);
    expect(isJsonRpcResponse(failure)).toBe(true);
    expect(isJsonRpcRequest(success)).toBe(false);
    expect(isJsonRpcNotification(success)).toBe(false);
  });
});

describe("encode helpers", () => {
  test("encode a request/notification/result/error as one NDJSON line", () => {
    expect(encodeJsonRpcRequest(1, "initialize", { protocolVersion: 1 })).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\n',
    );
    expect(encodeJsonRpcNotification("session/cancel", { sessionId: "s1" })).toBe(
      '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s1"}}\n',
    );
    expect(encodeJsonRpcResult("req-1", { outcome: { outcome: "cancelled" } })).toBe(
      '{"jsonrpc":"2.0","id":"req-1","result":{"outcome":{"outcome":"cancelled"}}}\n',
    );
    expect(encodeJsonRpcError(2, -32601, "Method not found")).toBe(
      '{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}\n',
    );
  });

  test("a request/notification with no params omits the field entirely", () => {
    expect(encodeJsonRpcRequest(1, "authenticate")).toBe('{"jsonrpc":"2.0","id":1,"method":"authenticate"}\n');
  });
});

describe("createIdMinter", () => {
  test("mints increasing ids starting at 1, independent across minters", () => {
    const a = createIdMinter();
    const b = createIdMinter();
    expect([a(), a(), a()]).toEqual([1, 2, 3]);
    expect(b()).toBe(1); // a fresh minter never sees the other's state
  });
});

describe("isMethodNotFoundError", () => {
  test("the reserved JSON-RPC code wins over any text", () => {
    expect(isMethodNotFoundError(new AcpRpcError(-32601, "whatever"))).toBe(true);
    expect(isMethodNotFoundError(new AcpRpcError(-32000, "method not found"))).toBe(true); // text sniff still fires
  });
  test("a textual sniff catches agents that don't use the reserved code", () => {
    expect(isMethodNotFoundError(new Error("Unknown method: session/resume"))).toBe(true);
    expect(isMethodNotFoundError(new Error("no such method"))).toBe(true);
  });
  test("an unrelated error is not a method-not-found", () => {
    expect(isMethodNotFoundError(new Error("network timeout"))).toBe(false);
    expect(isMethodNotFoundError("a plain string")).toBe(false);
  });
});

// ── Version-skew model-shape detection ───────────────────────────────────────────────────────

// PROVENANCE OF THE NEW-SHAPE FIXTURES BELOW. Every `configOptions` fixture in this block is
// written from, or explicitly derived from, `session/new` results captured live off cline 3.0.48,
// `goose acp`, and `openclaw acp` (with a real `openclaw gateway run` alongside it) — each installed
// locally and driven against a local mock model host, never a live account or a real LLM call.
// Each fixture says which it is, in its own comment: **captured** ones transcribe the payload; **derived** ones
// (abbreviated option lists, degenerate edge cases, filled-in ids) start from a captured structure
// and say exactly what was changed. Read the per-test note before treating any of them as wire
// truth — a blanket "all verbatim" claim here would be the same overclaim this block exists to
// remove. This provenance discipline matters because
// the fixtures these replaced used `{id, name}` select options, **a shape no shipping ACP agent
// has ever emitted** (`SessionConfigSelectOption` is `{value, name, description?}` in every
// @agentclientprotocol/sdk generation checked: 0.20.0, 0.24.0, 0.29.0, 1.3.0). Those fixtures were
// green against a fiction: they were written from the same research report as the code, so they
// agreed with each other and with nothing real, and they hid the fact that detectModelShape's
// `configOptions` branch had never returned a model from any real binary, for any backend.
// Do not "simplify" these back to `{id, …}`.
describe("detectModelShape", () => {
  test("reads option values (the spec shape), not ids", () => {
    // Captured live from cline 3.0.48 — see task-1-report.md §1a for the verbatim `session/new`.
    const info = detectModelShape({
      configOptions: [
        { type: "select", id: "model", name: "Model", category: "model", currentValue: "mock-model",
          options: [{ value: "gpt-4o", name: "gpt-4o" }] },
      ],
    });
    expect(info.shape).toBe("new");
    expect(info.models.map((m) => m.value)).toEqual(["gpt-4o"]);
    expect(info.modelConfigId).toBe("model");
  });

  test("picks the MODEL selector when a PROVIDER selector shares category 'model' and comes first", () => {
    // Captured live from cline 3.0.48 — both selectors carry category:"model", provider FIRST, and
    // BOTH option lists are `{value, name}`, so nothing about the options themselves separates
    // them. "First category:'model' wins" would set modelConfigId:"provider" and list two OAuth
    // providers as if they were models — populated-but-wrong, i.e. worse than an empty picker,
    // because driver.ts's setModel would then write a model id into cline's provider option.
    const info = detectModelShape({
      configOptions: [
        { type: "select", id: "provider", name: "Provider", category: "model", currentValue: "openai-compatible",
          options: [{ value: "cline", name: "Cline Usage-Billing" }, { value: "openai-codex", name: "OpenAI ChatGPT Subscription" }] },
        { type: "select", id: "model", name: "Model", category: "model", currentValue: "mock-model",
          options: [{ value: "gpt-4o", name: "gpt-4o" }] },
      ],
    });
    expect(info.models.map((m) => m.value)).toEqual(["gpt-4o"]);
    expect(info.modelConfigId).toBe("model"); // NOT "provider"
  });

  test("disambiguates by intersecting with models.availableModels when neither selector is id 'model'", () => {
    // Rule 2 of the ranked disambiguator. Same cline payload, but with the selector ids renamed so
    // rule 1 (`id === "model"`) cannot fire — cline sends BOTH shapes, and the old shape's
    // `availableModels` names the real model ("gpt-4o"), which appears in exactly one of the two
    // category:"model" option lists. Guards the rule that would otherwise be untested because rule
    // 1 happens to fire for every agent observed so far.
    const info = detectModelShape({
      models: { availableModels: [{ modelId: "gpt-4o", name: "gpt-4o" }], currentModelId: "mock-model" },
      configOptions: [
        { type: "select", id: "auth_provider", name: "Provider", category: "model", currentValue: "openai-compatible",
          options: [{ value: "cline", name: "Cline Usage-Billing" }, { value: "openai-codex", name: "OpenAI ChatGPT Subscription" }] },
        { type: "select", id: "llm", name: "Model", category: "model", currentValue: "mock-model",
          options: [{ value: "gpt-4o", name: "gpt-4o" }] },
      ],
    });
    expect(info.shape).toBe("new");
    expect(info.models.map((m) => m.value)).toEqual(["gpt-4o"]);
    expect(info.modelConfigId).toBe("llm"); // NOT "auth_provider"
  });

  test("an EMPTY selector named 'model' does not beat a populated sibling", () => {
    // DERIVED, not captured: no observed agent emits this. Rule 1 (`id === "model"`) is a strong
    // signal but not strong enough to outrank having any models at all — without the non-empty
    // qualifier this returns the empty `id:"model"` entry and discards two real models, producing
    // an empty picker whose modelConfigId points at a selector with nothing in it.
    const info = detectModelShape({
      configOptions: [
        { type: "select", id: "llm", name: "Model", category: "model", currentValue: "a",
          options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] },
        { type: "select", id: "model", name: "Model", category: "model", options: [] },
      ],
    });
    expect(info.models.map((m) => m.value)).toEqual(["a", "b"]);
    expect(info.modelConfigId).toBe("llm");
  });

  test("flattens grouped options", () => {
    // `SessionConfigSelectOptions` is `Array<SessionConfigSelectOption> | Array<SessionConfigSelectGroup>`,
    // a group being `{group, name, options: [...]}`. No agent observed here emits groups yet, but
    // the union is in every SDK generation and an unflattened group yields ZERO models.
    const info = detectModelShape({
      configOptions: [
        { type: "select", id: "model", category: "model",
          options: [{ group: "fast", name: "Fast", options: [{ value: "a", name: "A" }] },
                    { group: "slow", name: "Slow", options: [{ value: "b", name: "B" }] }] },
      ],
    });
    expect(info.models.map((m) => m.value)).toEqual(["a", "b"]);
  });

  test("goose keeps its config ids on an EMPTY model list — new-shape-only agents never fall through", () => {
    // THE no-fall-through regression guard. goose's captured `session/new` has top-level keys
    // ["sessionId","modes","configOptions","_meta"] — **no `models` field at all** — so it is a
    // new-shape-ONLY agent with nothing to fall back to. An earlier proposed fix fell through to the
    // old shape whenever the new one yielded no models, which nulled goose's
    // modelConfigId/effortConfigId — both CORRECT, and both consumed by driver.ts's
    // setModel/setEffort, which would have become permanent no-ops.
    //
    // The option list is EMPTY on purpose, and that is the whole point. This replaces an earlier
    // version of this guard that used a populated list (`[{value:"g1"}]`): once `value` is read
    // correctly goose's list is non-empty, so the "chosen entry yielded zero models" gate was never
    // reached and re-adding the over-eager fall-through left it — and every other assertion in this
    // file — green. It asserted three things that were already true before the fix and stayed true
    // under the sabotage, and its payload was a strict subset of this one, so no behavioural
    // sabotage could fire it without firing this first. Found by sabotaging, not by reading; the
    // two were folded into this one test. Do not "restore" the populated variant.
    //
    // Payload: goose's captured structure with the model selector's option list emptied — a DERIVED
    // degenerate case, not a verbatim capture, and the exact boundary the rule governs. Falling
    // through here yields shape "none" with BOTH config ids null, for an agent whose ids were
    // perfectly good. An empty list is not a reason to discard working handles.
    const info = detectModelShape({
      configOptions: [
        { type: "select", id: "model", category: "model", currentValue: "claude-haiku-4-5", options: [] },
        { type: "select", id: "thinking_effort", category: "thought_level", options: [{ value: "high", name: "High" }] },
      ],
    });
    expect(info.shape).toBe("new");
    expect(info.models).toEqual([]);
    expect(info.modelConfigId).toBe("model");
    expect(info.effortConfigId).toBe("thinking_effort");
    expect(info.currentModelId).toBe("claude-haiku-4-5");
  });

  test("NEW shape: configOptions with category 'model', plus a sibling thought_level option", () => {
    // Structure captured live from `goose acp` (task-1-report.md §1c): selector ids "model" and
    // "thinking_effort", categories "model"/"thought_level", currentValue "claude-haiku-4-5"/"off",
    // options `{value, name}`. The report elided goose's full option lists (6 models, 5 effort
    // levels) for length, so the lists here are a faithful SUBSET of that shape, not a verbatim
    // transcription of all 11 entries — the shape is what this asserts on.
    const result = {
      sessionId: "sess_1",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "claude-haiku-4-5",
          options: [
            { value: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
            { value: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
          ],
        },
        {
          id: "thinking_effort",
          name: "Thinking effort",
          category: "thought_level",
          type: "select",
          currentValue: "off",
          options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
        },
      ],
    };
    const shape = detectModelShape(result);
    expect(shape.shape).toBe("new");
    expect(shape.currentModelId).toBe("claude-haiku-4-5");
    expect(shape.modelConfigId).toBe("model");
    expect(shape.effortConfigId).toBe("thinking_effort");
    expect(shape.models).toEqual([
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "", effortLevels: ["Low", "High"] },
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", description: "", effortLevels: ["Low", "High"] },
    ]);
  });

  test("NEW shape with no thought_level option → every model's effortLevels is [] (picker hides)", () => {
    const shape = detectModelShape({
      configOptions: [{ id: "cfg-model", category: "model", options: [{ value: "m1", name: "Model One" }] }],
    });
    expect(shape.shape).toBe("new");
    expect(shape.effortConfigId).toBeNull();
    expect(shape.models[0]?.effortLevels).toEqual([]);
  });

  test("BACK-COMPAT ONLY: an option carrying `id` instead of the spec's `value` is still read", () => {
    // The ONE deliberately-unreal fixture in this block. No shipping ACP agent emits `{id, name}`
    // select options (see this describe's provenance note); this covers detectModelShape's `id`
    // FALLBACK, kept so a hypothetical non-conforming emitter degrades rather than going blank.
    // If you are adding a new agent's fixture, copy one of the `{value, …}` cases above, not this.
    const shape = detectModelShape({
      configOptions: [{ id: "cfg-model", category: "model", options: [{ id: "legacy-m1", name: "Legacy Model One" }] }],
    });
    expect(shape.shape).toBe("new");
    expect(shape.models).toEqual([{ value: "legacy-m1", label: "Legacy Model One", description: "", effortLevels: [] }]);
  });

  test("OLD shape: NewSessionResponse.models.{availableModels,currentModelId} (claude-code-acp / cline)", () => {
    const shape = detectModelShape({
      sessionId: "sess_2",
      models: {
        currentModelId: "claude-sonnet-4-5",
        availableModels: [
          { modelId: "claude-sonnet-4-5", name: "Sonnet 4.5", description: "Balanced" },
          { modelId: "claude-opus-4-1" }, // no name/description — falls back to the id
        ],
      },
    });
    expect(shape.shape).toBe("old");
    expect(shape.currentModelId).toBe("claude-sonnet-4-5");
    expect(shape.modelConfigId).toBeNull();
    expect(shape.effortConfigId).toBeNull(); // old shape has no per-model effort granularity at all
    expect(shape.models).toEqual([
      { value: "claude-sonnet-4-5", label: "Sonnet 4.5", description: "Balanced", effortLevels: [] },
      { value: "claude-opus-4-1", label: "claude-opus-4-1", description: "", effortLevels: [] },
    ]);
  });

  test("NONE: an agent with configOptions but no category 'model' entry and no models field (openclaw)", () => {
    // DERIVED from the `openclaw acp` capture (task-1-report.md §1c). What is captured: a populated
    // `configOptions` array whose categories are thought_level / fast_mode / verbose_level /
    // reasoning_level / response_usage / elevated_level, with NO category:"model" entry and no
    // `models` field. The report records only those category NAMES, so the selector ids and option
    // values below are filled in — the facts this asserts on (no model category, no models field,
    // therefore "none") are real; the specific strings are not transcribed.
    // The complement of the goose rule: falling through IS correct here, because there is no
    // category:"model" entry AT ALL. Also pins that a non-model select is never mistaken for the
    // model list just because it is a populated select — the category check is load-bearing.
    const info = detectModelShape({
      sessionId: "sess_openclaw",
      configOptions: [
        { type: "select", id: "thought_level", category: "thought_level", options: [{ value: "off", name: "Off" }, { value: "high", name: "High" }] },
        { type: "select", id: "fast_mode", category: "fast_mode", options: [{ value: "on", name: "On" }] },
        { type: "select", id: "verbose_level", category: "verbose_level", options: [{ value: "low", name: "Low" }] },
      ],
    });
    expect(info.shape).toBe("none");
    expect(info.models).toEqual([]);
    expect(info.modelConfigId).toBeNull();
    expect(info.effortConfigId).toBeNull();
  });

  test("NONE: neither shape present, or a malformed/absent result — never throws", () => {
    expect(detectModelShape({ sessionId: "s" })).toEqual({
      shape: "none",
      models: [],
      currentModelId: null,
      modelConfigId: null,
      effortConfigId: null,
    });
    expect(detectModelShape(null).shape).toBe("none");
    expect(detectModelShape(undefined).shape).toBe("none");
    expect(detectModelShape("garbage").shape).toBe("none");
    expect(detectModelShape({ configOptions: "not an array" }).shape).toBe("none");
    expect(detectModelShape({ models: { availableModels: "nope" } }).models).toEqual([]);
  });

  test("entries with no usable id are dropped without crashing the rest of the list", () => {
    const shape = detectModelShape({
      models: { availableModels: [{ modelId: "" }, { name: "no id at all" }, { modelId: "ok" }] },
    });
    expect(shape.models.map((m) => m.value)).toEqual(["ok"]);
  });
});

// ── Content-block / tool-call rendering helpers ──────────────────────────────────────────────

describe("contentBlockText", () => {
  test("text rides through; non-text kinds get a bracketed placeholder; unknown/malformed → ''", () => {
    expect(contentBlockText({ type: "text", text: "hello" })).toBe("hello");
    expect(contentBlockText({ type: "image" })).toBe("[image]");
    expect(contentBlockText({ type: "audio" })).toBe("[audio]");
    expect(contentBlockText({ type: "resource_link", name: "spec.md", uri: "file:///spec.md" })).toBe("[spec.md](file:///spec.md)");
    expect(contentBlockText({ type: "resource_link", uri: "file:///x" })).toBe("[resource](file:///x)");
    expect(contentBlockText({ type: "resource" })).toBe("[embedded resource]");
    expect(contentBlockText({ type: "something_future" })).toBe("");
    expect(contentBlockText(null)).toBe("");
    expect(contentBlockText("garbage")).toBe("");
  });
});

describe("toolCallContentText", () => {
  test("renders content entries and diff summaries; falls back to raw JSON for anything else", () => {
    expect(
      toolCallContentText([
        { type: "content", content: { type: "text", text: "file contents" } },
        { type: "diff", path: "src/foo.ts" },
      ]),
    ).toBe("file contents\ndiff: src/foo.ts");
    expect(toolCallContentText([{ type: "diff" }])).toBe("diff");
    expect(toolCallContentText([{ type: "future_kind", x: 1 }])).toBe('{"type":"future_kind","x":1}');
  });
  test("non-array / empty content yields ''", () => {
    expect(toolCallContentText(undefined)).toBe("");
    expect(toolCallContentText(null)).toBe("");
    expect(toolCallContentText([])).toBe("");
  });
});

describe("toolCallInput", () => {
  test("carries title as description (summarizeInput's recognized key) and kind", () => {
    expect(toolCallInput({ title: "Reading src/index.ts", kind: "read" })).toEqual({
      description: "Reading src/index.ts",
      kind: "read",
    });
  });
  test("no usable fields → undefined (no empty-object chip)", () => {
    expect(toolCallInput({})).toBeUndefined();
    expect(toolCallInput({ title: "" })).toBeUndefined();
  });

  // ── rawInput: the arguments a real ACP ToolCall actually carries ────────────────────────────
  // ACP's ToolCall has a `rawInput` object ("Raw input parameters sent to the tool"), and real
  // agents populate it — goose's own compiled serde field table lists it on ToolCall, next to
  // `kind`/`status`/`locations`/`rawOutput`.

  test("rawInput's structured arguments ride through alongside the synthesized fields", () => {
    expect(toolCallInput({ title: "Reading src/index.ts", kind: "read", rawInput: { file_path: "/etc/hosts", limit: 40 } })).toEqual({
      file_path: "/etc/hosts",
      limit: 40,
      description: "Reading src/index.ts",
      kind: "read",
    });
  });

  test("on a name collision the ToolCall's OWN title/kind win over identically-named rawInput keys", () => {
    // The precedence this pins, and why: `description` and `kind` here are not arguments, they are
    // the ACP-level identity of the call — `kind` is the same token the tool-use frame carries for
    // icon selection, and `description` is the title every surface labels the call by. A tool
    // parameter that happens to share one of those names must not be able to make the derived input
    // disagree with the chip and the permission modal. Everything NOT colliding still rides through
    // (`path` below), so the merge stays additive.
    expect(
      toolCallInput({
        title: "Write foo.txt",
        kind: "edit",
        rawInput: { description: "a tool argument that happens to be named description", kind: "not-a-toolkind", path: "/tmp/foo.txt" },
      }),
    ).toEqual({ description: "Write foo.txt", kind: "edit", path: "/tmp/foo.txt" });
  });

  test("rawInput alone (no title, no kind) still produces an input rather than undefined", () => {
    expect(toolCallInput({ rawInput: { query: "gcal" } })).toEqual({ query: "gcal" });
  });

  test("an EMPTY rawInput contributes nothing, and on its own yields no empty-object chip", () => {
    // A real goose `bismuth_docs_list` call sends exactly this — the tool takes no arguments.
    expect(toolCallInput({ title: "bismuth: bismuth docs list", rawInput: {} })).toEqual({ description: "bismuth: bismuth docs list" });
    expect(toolCallInput({ rawInput: {} })).toBeUndefined();
  });

  test("a rawInput that is not a plain object is ignored rather than spread key-by-key", () => {
    expect(toolCallInput({ title: "T", rawInput: "garbage" })).toEqual({ description: "T" });
    expect(toolCallInput({ title: "T", rawInput: ["a", "b"] })).toEqual({ description: "T" });
    expect(toolCallInput({ title: "T", rawInput: null })).toEqual({ description: "T" });
  });
});

describe("toolCallName", () => {
  // The one function BOTH surfaces that name a ToolCall now call — the tool chip (translateSessionUpdate,
  // below) and the permission modal (driver.ts). They used to be two inline expressions with two
  // different field orders, so on real traffic (`title` present, `name` absent from the schema
  // entirely) the chip said "edit" while the modal said "Write foo.txt" for the same call.
  // core/test/chatProviders/acpPermissionFakeAgent.test.ts proves they now agree end-to-end; these
  // pin the ordering itself.
  test("prefers `title` — the only human-readable field a real ToolCall carries — over `kind`", () => {
    expect(toolCallName({ title: "Write foo.txt", kind: "edit" })).toBe("Write foo.txt");
  });
  test("falls back to `kind` only when there is no title", () => {
    expect(toolCallName({ kind: "edit" })).toBe("edit");
    expect(toolCallName({ title: "", kind: "edit" })).toBe("edit");
  });
  test("`name` is honored ahead of both, as tolerance for a non-conforming agent that invents one", () => {
    // No shipping agent sends this — ACP's ToolCall has no `name` field. The clause exists so such an
    // agent degrades predictably, and lives here (rather than in one call site) so the two surfaces
    // cannot disagree about it again.
    expect(toolCallName({ name: "Bash", title: "Run the tests", kind: "execute" })).toBe("Bash");
  });
  test("nothing usable → the generic label, never an empty chip", () => {
    expect(toolCallName({})).toBe("tool");
    expect(toolCallName({ title: "", kind: "", name: "" })).toBe("tool");
    expect(toolCallName({ title: 42, kind: null })).toBe("tool"); // non-strings are not labels
  });
});

// ── session/update → ChatFrame[] ─────────────────────────────────────────────────────────────

describe("translateSessionUpdate", () => {
  test("agent_message_chunk / agent_thought_chunk → assistant-text / thinking; empty text → []", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi there" } }, state)).toEqual([
      { type: "assistant-text", text: "Hi there" },
    ]);
    expect(translateSessionUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking…" } }, state)).toEqual([
      { type: "thinking", text: "thinking…" },
    ]);
    expect(translateSessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } }, state)).toEqual([]);
  });

  test("tool_call (pending) emits only the chip; a LATER tool_call_update resolves it once", () => {
    const state = newAcpTranslateState(blankManifest());
    // Named by `title`, matching what driver.ts's permission modal calls the same ToolCall (see
    // toolCallName above); `kind` is carried alongside for the icon, never as the label.
    expect(
      translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tc_1", title: "Reading src/index.ts", kind: "read", status: "in_progress" }, state),
    ).toEqual([
      { type: "tool-use", id: "tc_1", name: "Reading src/index.ts", kind: "read", input: { description: "Reading src/index.ts", kind: "read" } },
    ]);
    expect(
      translateSessionUpdate(
        { sessionUpdate: "tool_call_update", toolCallId: "tc_1", status: "completed", content: [{ type: "content", content: { type: "text", text: "<file contents>" } }] },
        state,
      ),
    ).toEqual([{ type: "tool-result", id: "tc_1", content: "<file contents>", isError: false }]);
    // A stray re-delivery of the same completed update neither re-opens the chip nor double-resolves it.
    expect(
      translateSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tc_1", status: "completed", content: [] }, state),
    ).toEqual([]);
  });

  test("tool_call that arrives ALREADY resolved emits both the chip and its result together", () => {
    const state = newAcpTranslateState(blankManifest());
    const frames = translateSessionUpdate(
      { sessionUpdate: "tool_call", toolCallId: "tc_2", title: "Search", kind: "search", status: "completed", content: [{ type: "content", content: { type: "text", text: "3 matches" } }] },
      state,
    );
    expect(frames).toEqual([
      { type: "tool-use", id: "tc_2", name: "Search", kind: "search", input: { description: "Search", kind: "search" } },
      { type: "tool-result", id: "tc_2", content: "3 matches", isError: false },
    ]);
  });

  test("a tool_call with NO kind omits the field entirely rather than carrying an empty string", () => {
    // This pins the `kind || undefined` in translateSessionUpdate. Precisely: toEqual ignores keys
    // whose value is `undefined` (so `kind: undefined` and an absent `kind` both satisfy the
    // expectation — that part is NOT what this asserts) but does compare a `kind: ""`, which fails.
    // So the assertion catches exactly the regression worth catching: an empty-string kind reaching
    // the frontend, where it would be present-but-meaningless to anything reading the frame.
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tc_4", title: "Run tests", status: "in_progress" }, state)).toEqual([
      { type: "tool-use", id: "tc_4", name: "Run tests", input: { description: "Run tests" } },
    ]);
  });

  test("a tool_call's rawInput reaches the tool-use frame's input without disturbing name or kind", () => {
    const state = newAcpTranslateState(blankManifest());
    // `rawInput.kind` is deliberately a DIFFERENT string from the ToolCall's own `kind`, so the
    // three things this pins fail independently: the arguments reach `input`, the frame's `kind`
    // (what picks the icon) still comes from the ToolCall, and `input.kind` does too.
    expect(
      translateSessionUpdate(
        { sessionUpdate: "tool_call", toolCallId: "tc_5", title: "Search the docs", kind: "search", status: "in_progress", rawInput: { query: "gcal", kind: "not-a-toolkind" } },
        state,
      ),
    ).toEqual([{ type: "tool-use", id: "tc_5", name: "Search the docs", kind: "search", input: { query: "gcal", description: "Search the docs", kind: "search" } }]);
  });

  test("a failed tool_call_update carries isError:true", () => {
    const state = newAcpTranslateState(blankManifest());
    translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tc_3", title: "Run tests", status: "in_progress" }, state);
    expect(
      translateSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tc_3", status: "failed", content: [{ type: "content", content: { type: "text", text: "2 failing" } }] }, state),
    ).toEqual([{ type: "tool-result", id: "tc_3", content: "2 failing", isError: true }]);
  });

  test("tool_call/tool_call_update with no toolCallId yields []", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "tool_call", title: "orphan" }, state)).toEqual([]);
    expect(translateSessionUpdate({ sessionUpdate: "tool_call_update", status: "completed" }, state)).toEqual([]);
  });

  test("a pending/in_progress tool_call_update carries nothing new (the chip is already up)", () => {
    const state = newAcpTranslateState(blankManifest());
    translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tc_4", title: "Working" }, state);
    expect(translateSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "tc_4", status: "in_progress" }, state)).toEqual([]);
  });

  test("available_commands_update refreshes the manifest's slash-command fields and re-emits it", () => {
    const state = newAcpTranslateState(blankManifest());
    const frames = translateSessionUpdate(
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "review", description: "Review changes" },
          { name: "init" }, // no description — still a valid command name
        ],
      },
      state,
    );
    expect(frames).toEqual([
      {
        type: "manifest",
        manifest: { ...blankManifest(), slashCommands: ["review", "init"], commandDetails: { review: "Review changes" } },
      },
    ]);
  });

  test("usage_update tracks used/size as a context frame and accumulates cost across calls", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "usage_update", used: 500, size: 2000 }, state)).toEqual([
      { type: "context", percentage: 25, totalTokens: 500, maxTokens: 2000 },
    ]);
    expect(state.costUsd).toBeNull(); // no cost field yet
    translateSessionUpdate({ sessionUpdate: "usage_update", used: 800, size: 2000, cost: { amount: 0.02, currency: "USD" } }, state);
    expect(state.costUsd).toBeCloseTo(0.02);
    translateSessionUpdate({ sessionUpdate: "usage_update", used: 900, size: 2000, cost: { amount: 0.01, currency: "USD" } }, state);
    expect(state.costUsd).toBeCloseTo(0.03); // accumulates across usage_update events
  });

  test("usage_update with no size (or size 0) emits no context frame, but still not-error", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "usage_update", used: 10 }, state)).toEqual([]);
    expect(translateSessionUpdate({ sessionUpdate: "usage_update", used: 10, size: 0 }, state)).toEqual([]);
  });

  test("known-but-UI-inert kinds (plans, mode/config echoes, session metadata, user echo) yield []", () => {
    const state = newAcpTranslateState(blankManifest());
    for (const kind of ["plan", "plan_update", "plan_removed", "session_info_update", "current_mode_update", "config_option_update", "user_message_chunk"]) {
      expect(translateSessionUpdate({ sessionUpdate: kind }, state)).toEqual([]);
    }
  });

  test("an unknown FUTURE sessionUpdate kind yields [] rather than throwing", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate({ sessionUpdate: "something_from_a_newer_sdk" }, state)).toEqual([]);
  });

  test("malformed input (null / non-object / missing sessionUpdate) is tolerated", () => {
    const state = newAcpTranslateState(blankManifest());
    expect(translateSessionUpdate(null, state)).toEqual([]);
    expect(translateSessionUpdate(undefined, state)).toEqual([]);
    expect(translateSessionUpdate("garbage", state)).toEqual([]);
    expect(translateSessionUpdate({}, state)).toEqual([]);
    expect(translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: 42 }, state)).toEqual([]); // non-string id
  });
});

// ── Permission-option mapping ─────────────────────────────────────────────────────────────────

describe("choosePermissionOption", () => {
  const options = [
    { kind: "allow_once", optionId: "opt-allow-once", name: "Allow once" },
    { kind: "allow_always", optionId: "opt-allow-always", name: "Allow always" },
    { kind: "reject_once", optionId: "opt-reject-once", name: "Reject once" },
    { kind: "reject_always", optionId: "opt-reject-always", name: "Reject always" },
  ];

  test("exact allow/deny × once/always matches win", () => {
    expect(choosePermissionOption(options, { behavior: "allow" })).toBe("opt-allow-once");
    expect(choosePermissionOption(options, { behavior: "allow", always: true })).toBe("opt-allow-always");
    expect(choosePermissionOption(options, { behavior: "deny" })).toBe("opt-reject-once");
    expect(choosePermissionOption(options, { behavior: "deny", always: true })).toBe("opt-reject-always");
  });

  test("falls back to the right family when the exact once/always variant is missing", () => {
    const onlyAlways = [{ kind: "allow_always", optionId: "a", name: "Allow always" }];
    expect(choosePermissionOption(onlyAlways, { behavior: "allow" })).toBe("a"); // wanted allow_once, got allow family
  });

  test("last resort: the first offered option when nothing matches the family either", () => {
    const weird = [{ kind: "some_custom_kind", optionId: "z", name: "?" }];
    expect(choosePermissionOption(weird, { behavior: "deny" })).toBe("z");
  });

  test("zero usable options → null (the driver then answers cancelled)", () => {
    expect(choosePermissionOption([], { behavior: "allow" })).toBeNull();
    expect(choosePermissionOption([{ kind: "allow_once" }], { behavior: "allow" })).toBeNull(); // no optionId — unusable
  });
});
