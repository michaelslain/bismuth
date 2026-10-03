# Local models

Run Bismuth's chats on an open model served from your own machine — LM Studio, Ollama, llama.cpp, vLLM, or anything that speaks the OpenAI or Anthropic API — instead of each CLI's cloud account. It is one setting, `localModel`, in the vault's `.settings`; the existing chat backends do the rest. Key reference: [`localModel`](../settings/reference.md#localmodel).

## What it does, and what it does not

- **Scoped to Bismuth chats.** When `localModel.enabled` is `true`, every chat on a backend that supports it (table below) talks to your local server. Chats on other backends run as normal.
- **Never edits a CLI's own config.** Nothing is written to `~/.claude`, `~/.codex`, `~/.config/opencode` or `~/.config/goose`. The wiring is spawn-time env vars and flags, so running `claude` or `codex` yourself in a terminal is unaffected.
- **Picked up by the next chat or turn.** Claude Code reads the setting when a chat opens (a chat already open keeps its server); Codex reads it on every turn. Opencode and Goose read it when they next spawn.
- **No silent fallback.** If the setting is on and the server answers `GET <url>/v1/models` with no models (not running, or nothing loaded), the chat shows `No local model server answered at <url> (or it lists no models). Start LM Studio or Ollama, or turn off localModel in .settings.` as an error. It does not quietly use your cloud account.
- **Pinned to the server's models.** While `localModel` is on, a chat's model picker lists the server's ids only; a cloud model remembered from an earlier chat is ignored. Turn the setting off to use cloud models again.
- **The header model picker lists the server's models.** In a Claude Code chat the picker shows the ids from `/v1/models`, and picking one applies from the next turn. A model remembered from a cloud chat (a resumed chat's `opus`) is ignored unless the server lists it.

## The four fields

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `false` | The master switch. |
| `url` | `http://localhost:1234` | The server's base URL, without a trailing `/` or `/v1`. |
| `model` | `""` | A model id exactly as the server lists it at `/v1/models`. Empty means the first listed model. LM Studio can load an id it does not list on demand, so the value is trusted as written. |
| `apiKey` | `""` | Sent as a bearer token when set. Most local servers ignore it; the CLIs insist on some value, so a placeholder is used when this is empty. |

## Which backends use it

| Backend | Server endpoint it needs | Minimum LM Studio / Ollama |
|---------|--------------------------|----------------------------|
| Claude Code | `/v1/messages` (Anthropic) | LM Studio 0.4.1 / Ollama 0.14 |
| Codex | `/v1/responses` (OpenAI Responses) | LM Studio 0.3.29 / Ollama 0.13.3 |
| opencode | `/v1/chat/completions` | any server serving it |
| Goose | `/v1/chat/completions` | any server serving it |

Every other backend (cline, gemini, openclaw, Hermes and the other ACP adapters) ignores the setting. `bismuth backends` lists `local` among the surfaces of each backend that supports it.

How each is wired, all at spawn time:

- **Claude Code** — `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and every model-role variable (`ANTHROPIC_MODEL`, the `ANTHROPIC_DEFAULT_*_MODEL` family, `CLAUDE_CODE_SUBAGENT_MODEL`) set to the chosen model, so background and subagent calls never name a Claude model the server has never heard of.
- **Codex** — `--config` overrides that define a custom `bismuth_local` provider with `wire_api="responses"` and the chosen `--model`; the key rides `BISMUTH_LOCAL_MODEL_KEY`. Codex prints a "Model metadata not found" warning for any model outside its catalog; a local turn does not show it as an error.
- **opencode** — an inline `OPENCODE_CONFIG_CONTENT` declaring a `local` provider, which outranks your own opencode config without replacing it.
- **Goose** — `GOOSE_PROVIDER=openai` plus `OPENAI_HOST`, `OPENAI_BASE_PATH`, `GOOSE_MODEL` and `OPENAI_API_KEY`.

## Setup snippets

LM Studio (start its local server, load a model):

```yaml
localModel:
  enabled: true
  url: http://localhost:1234
  model: qwen3-coder-30b
```

Ollama:

```yaml
localModel:
  enabled: true
  url: http://localhost:11434
  model: gpt-oss:20b
```

## Pick a model that can call tools

These are coding agents: they drive file edits, shell commands and the Bismuth CLI through tool calls. A model without tool-calling support will chat but never act, or emit malformed calls. Pick a tool-capable model, and give it a context window of roughly 25k tokens or more — the agents' system prompts and tool schemas alone take a large share of a small window. In Ollama the default context is small, so raise it (`OLLAMA_CONTEXT_LENGTH`, or the model's `num_ctx`); in LM Studio set the context length when loading the model.

## Related

- [Agent backends](backends.md) — the backend catalog and capability model, including `localModel`
- [Chat providers](providers.md) — the provider seam and the Codex / opencode drivers
- [Settings reference](../settings/reference.md#localmodel) — the `localModel` keys and defaults
