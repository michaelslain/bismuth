# opencode providers

An opencode chat runs on whichever provider the user has connected to **opencode** (Anthropic, OpenAI, OpenRouter, GitHub Copilot, ...). The provider manager (`app/src/chat/OpencodeProviderManager.tsx`) shows what is connected and lets the user connect more without leaving the app. It is the body of the **model dialog**: open it from the model word in the chat's controls row under the composer, choose the `opencode` connector, and it fills the dialog's right column beneath the model list (see [the controls row and model dialog](overview.md#the-controls-row-and-model-dialog)). There is no separate credentials pill or popover. It drives the same `opencode serve` process every opencode chat already shares ([Chat providers](providers.md)), through four owner-only core routes.

## What the manager does

- **Connected** — one row per provider opencode reports as connected, with how: `api key`, `oauth` or `env` (an environment variable the server inherited).
- **Add a provider** — a filterable list of every provider that is not connected yet. An API-key provider takes a pasted key; an OAuth provider opens its sign-in page.
- **API key** — the key goes to `POST /opencode/auth`, core hands it to opencode's `auth.set`, and opencode writes it to its **own** credential store. Bismuth never persists it, logs it, or echoes it back: an error from opencode is scrubbed of the key before it reaches the response.
- **OAuth** — `POST /opencode/oauth/authorize` returns the URL to open and whether the flow is `auto` (opencode finishes when the browser callback lands) or `code` (the user pastes a code); `POST /opencode/oauth/callback` finishes it.
- After a successful connect core re-emits the `models` and `auth` frames to every live opencode chat, so the new provider's models appear in the model dialog's list (grouped under the provider's name) without reopening the chat.

Route shapes, status codes and error bodies are in the [HTTP reference](../api/http-reference.md#opencode-provider-manager-opencode).

## No account needed for Zen's free models

Measured 2026-10-05 against opencode 1.18.34: with an empty `$HOME` and no sign-in, `opencode models opencode` lists Zen's free models and `opencode run -m opencode/big-pickle` answers. So a user with no coding agent can chat for free. The chat setup screen's `[set up free agent]` downloads opencode into `~/.bismuth/agents/bin` and makes Zen Free (rotating) (`bismuth/zen-free-rotate`) the default model. Some free models log or train on prompts, and the setup screen says so. opencode can change this at any time; if a free turn is answered with a 401 it surfaces as a normal turn error. The daemon still needs Claude Code or Codex, since opencode has no daemon surface.

## Not installed

The routes answer `409 { error: "opencode-missing" }` when the `opencode` binary is absent or its server will not start. The manager shows that message in place of the lists; the terminal footer below still works.

## Anything else: the terminal

There is no provider disconnect here — opencode's SDK has no auth-remove call, and `opencode auth logout` is an interactive wizard. Anything the manager does not cover (disconnecting, custom providers, a provider that needs several prompts) is `opencode auth login` / `opencode auth logout` in a terminal, which the manager's footer opens or copies. Credentials written that way show up the next time the manager opens.

## The local model is not listed here

When [`localModel`](../settings/reference.md) is on, opencode also carries a `local` provider that Bismuth injects at spawn time (`OPENCODE_CONFIG_CONTENT`). It is configured in `.settings`, not connected here, so it is filtered out of both lists. When the local config changes, the shared server is replaced — immediately when no opencode turn is running, otherwise once the running turn settles — so a turn is never cut off mid-answer.
