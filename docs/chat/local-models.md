# Local models

Local models run Bismuth's chats on an open model served from your own machine (LM Studio, Ollama, llama.cpp, vLLM, or anything that speaks the OpenAI or Anthropic API) instead of each CLI's cloud account.
It is one setting, `localModel`, in the vault's `.settings`; the existing chat backends do the rest. Key reference: [`localModel`](../settings/reference.md#localmodel).

```yaml
localModel:
  enabled: true
  url: http://localhost:1234
  model: qwen3-coder-30b
```

## What does it change, and what does it leave alone?

- Scope. When `localModel.enabled` is `true`, every chat on a backend that supports it (table below) talks to your local server. Chats on other backends run as normal.
- No config edits. Nothing is written to `~/.claude`, `~/.codex`, `~/.config/opencode` or `~/.config/goose`. The wiring is spawn-time env vars and flags, so running `claude` or `codex` yourself in a terminal is unaffected.
- When it applies. Claude Code reads the setting when a chat opens (a chat already open keeps its server); Codex reads it on every turn. opencode and Goose read it when they next spawn.
- No silent fallback. If the setting is on and the server answers `GET <url>/v1/models` with no models (not running, or nothing loaded), the chat shows `No local model server answered at <url> (or it lists no models). Start LM Studio or Ollama, or turn off localModel in .settings.` as an error.
  It does not fall back to your cloud account.
- Model picker. While `localModel` is on, a chat's model picker lists the server's model ids only, and picking one applies from the next turn. A cloud model remembered from an earlier chat (a resumed chat's `opus`) is ignored unless the server lists it. Turn the setting off to use cloud models again.

## What are the four fields?

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `false` | The master switch. |
| `url` | `http://localhost:1234` | The server's base URL, without a trailing `/` or `/v1`. |
| `model` | `""` | A model id exactly as the server lists it at `/v1/models`. Empty means the first listed model. LM Studio can load an id it does not list on demand, so the value is trusted as written. |
| `apiKey` | `""` | Sent as a bearer token when set. Most local servers ignore it; the CLIs insist on some value, so a placeholder is used when this is empty. |

## Which backends use it?

Four backends honor `localModel`: the ones whose catalog entry has the `localModel` capability. Every other backend ignores the setting, and `bismuth backends` lists `local` among the surfaces of each backend that supports it.

| Backend | Server endpoint it needs | Minimum LM Studio / Ollama |
|---------|--------------------------|----------------------------|
| Claude Code | `/v1/messages` (Anthropic) | LM Studio 0.4.1 / Ollama 0.14 |
| Codex | `/v1/responses` (OpenAI Responses) | LM Studio 0.3.29 / Ollama 0.13.3 |
| opencode | `/v1/chat/completions` | any server serving it |
| Goose | `/v1/chat/completions` | any server serving it |

Each backend is wired at spawn time:

- Claude Code gets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and every model-role variable (`ANTHROPIC_MODEL`, the `ANTHROPIC_DEFAULT_*_MODEL` family, `CLAUDE_CODE_SUBAGENT_MODEL`) set to the chosen model, so background and subagent calls never name a Claude model the server has never heard of.
- Codex gets `--config` overrides that define a custom `bismuth_local` provider with `wire_api="responses"` and the chosen `--model`; the key rides `BISMUTH_LOCAL_MODEL_KEY`. Codex prints a "Model metadata not found" warning for any model outside its catalog; a local turn does not show it as an error.
- opencode gets an inline `OPENCODE_CONFIG_CONTENT` declaring a `local` provider, which outranks your own opencode config without replacing it.
- Goose gets `GOOSE_PROVIDER=openai` plus `OPENAI_HOST`, `OPENAI_BASE_PATH`, `GOOSE_MODEL` and `OPENAI_API_KEY`.

## How does Bismuth know the context window?

opencode only compacts a long conversation before it overflows when it knows the model's real window, so Bismuth reads the loaded window from the server and gives it to opencode as the model's `limit`. The window is what the server allocated at load, never the larger maximum the model supports.

| Server | Route read | Window |
|--------|------------|--------|
| LM Studio | `GET /api/v0/models` | `loaded_context_length` of a loaded model |
| Ollama | `GET /api/ps` | `context_length` of a running model |
| llama.cpp | `GET /props` | `n_ctx` per slot |
| vLLM | `GET /v1/models` | `max_model_len` |
| other OpenAI-compatible | `GET /v1/models` | none reported |

The server kind is identified by the route that answers. Embedding models are dropped from every list.
The injected limit is `{context: window, output: min(the model's own output limit, window)}`, or the window for both when none is known. It rides `OPENCODE_CONFIG_CONTENT` on the opencode processes Bismuth starts, for the `local` model, for servers saved from the provider manager, and for loopback models opencode lists from providers you configured yourself. A window that changes while Bismuth runs is read again before each turn on that model.

## What happens when the prompt does not fit the context window?

opencode's default prompt carries many tool descriptions, which an 8,192-token window cannot hold. When a turn fails because the loaded window is too small, Bismuth runs it again on a compact prompt: a short agent description, and only the tools that read, search and edit files. The failed attempt shows nothing, and the reply arrives as one normal turn. The failed attempt is removed from the conversation, so a reopened chat shows your message once. Later turns on that model start with the compact prompt. The compact prompt keeps the chat rendering note and the recalled memory and drops the session-start brain block.

A model whose window is too small even for the compact prompt ends the turn with an error that names the window:

```text
Qwen3.5 9B (local) is loaded with an 8,192-token context window, too small for an agent prompt. Load it with a larger context length (LM Studio: the model's load settings) and try again.
```

The parenthetical reads `(Ollama: the num_ctx parameter)` for Ollama and is absent for other servers. When the server reports no window, the message says the model ran out of context before the prompt fit.

## How does thinking work on a local model?

LM Studio returns a model's reasoning as `reasoning_content`, opencode streams it as a reasoning part, and the chat shows it as a thinking section. Only `reasoning_effort: none` turns thinking off. Models Bismuth declares (the `local` model and saved servers) list two effort levels, `none` and `high`, shown as `off` and `high`; no level is lit until you pick one, `off` sends `reasoning_effort: none`, and `high` thinks.
A model from your own opencode config gets effort levels by adding variants to it:

```json
{
  "provider": {
    "lmstudio": {
      "models": {
        "qwen/qwen3.5-9b": {
          "name": "qwen/qwen3.5-9b",
          "variants": {
            "none": { "reasoningEffort": "none" },
            "high": { "reasoningEffort": "high" }
          }
        }
      }
    }
  }
}
```

## How do I set up Ollama?

Start Ollama, pull a tool-capable model, then point `.settings` at its port:

```yaml
localModel:
  enabled: true
  url: http://localhost:11434
  model: gpt-oss:20b
```

For LM Studio, start its local server, load a model, and use the first snippet on this page.

## Which model should I pick?

Pick a model that can call tools, with a context window of roughly 25k tokens or more. These are coding agents: they drive file edits, shell commands and the Bismuth CLI through tool calls, so a model without tool calling will chat but never act, or emit malformed calls.
The agents' system prompts and tool schemas alone take a large share of a small window. In Ollama the default context is small, so raise it (`OLLAMA_CONTEXT_LENGTH`, or the model's `num_ctx`); in LM Studio set the context length when loading the model.

## Related

- [Agent backends](backends.md): the backend catalog and capability model, including `localModel`.
- [Chat providers](providers.md): the provider seam and the Codex and opencode drivers.
- [Settings reference](../settings/reference.md#localmodel): the `localModel` keys and defaults.

## How it works

`localSpawnFor` maps a backend id and the `localModel` settings to the env vars and argv above. `resolveLocalSpawn` wraps it: it reads `GET <url>/v1/models` first, and an empty answer ends the turn with the error code `local-model-unreachable` instead of starting the CLI.
Claude Code calls it when a chat opens, Codex at the start of every turn, and opencode and Goose when they spawn.

For opencode, a change to the local config replaces the shared `opencode serve` process: immediately when no opencode turn is running, otherwise once the running turn settles. A run-mode turn starts its own process with the config current at that moment.

For opencode, `opencodeConfigContent` (`opencodeConfig.ts`) builds the injected config from the local model, the saved servers and the detected limits, and `windowLimit` computes each limit. `probeLocalServer` and `detectWindow` (`contextWindowProbe.ts`) read the windows. The compact retry, `contextOverflowMessage` and `isContextOverflow` (`opencodeOverflow.ts`) are driven from `opencode.ts`.

Source: `core/src/agentBackends/localModel.ts`, `core/src/agentBackends/contextWindowProbe.ts`, `core/src/chatProviders/opencode/opencodeConfig.ts`, `core/src/chatProviders/opencode/opencodeOverflow.ts`, `core/src/agentBackends/localModelProbe.ts`, `core/src/agentBackends/catalog.ts` (`localModel` capability), `core/src/schema/settingsSchema.ts`
