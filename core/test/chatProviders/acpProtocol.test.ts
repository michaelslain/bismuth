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

describe("detectModelShape", () => {
  test("NEW shape: configOptions with category 'model', plus a sibling thought_level option", () => {
    const result = {
      sessionId: "sess_1",
      configOptions: [
        {
          id: "cfg-model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "sonnet",
          options: [
            { id: "sonnet", name: "Claude Sonnet" },
            { id: "opus", name: "Claude Opus" },
          ],
        },
        {
          id: "cfg-effort",
          name: "Thinking",
          category: "thought_level",
          type: "select",
          options: [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
        },
      ],
    };
    const shape = detectModelShape(result);
    expect(shape.shape).toBe("new");
    expect(shape.currentModelId).toBe("sonnet");
    expect(shape.modelConfigId).toBe("cfg-model");
    expect(shape.effortConfigId).toBe("cfg-effort");
    expect(shape.models).toEqual([
      { value: "sonnet", label: "Claude Sonnet", description: "", effortLevels: ["Low", "High"] },
      { value: "opus", label: "Claude Opus", description: "", effortLevels: ["Low", "High"] },
    ]);
  });

  test("NEW shape with no thought_level option → every model's effortLevels is [] (picker hides)", () => {
    const shape = detectModelShape({
      configOptions: [{ id: "cfg-model", category: "model", options: [{ id: "m1", name: "Model One" }] }],
    });
    expect(shape.shape).toBe("new");
    expect(shape.effortConfigId).toBeNull();
    expect(shape.models[0]?.effortLevels).toEqual([]);
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
    expect(
      translateSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "tc_1", title: "Reading src/index.ts", kind: "read", status: "in_progress" }, state),
    ).toEqual([{ type: "tool-use", id: "tc_1", name: "read", input: { description: "Reading src/index.ts", kind: "read" } }]);
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
      { type: "tool-use", id: "tc_2", name: "search", input: { description: "Search", kind: "search" } },
      { type: "tool-result", id: "tc_2", content: "3 matches", isError: false },
    ]);
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
