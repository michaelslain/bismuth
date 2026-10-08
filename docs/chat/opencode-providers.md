# opencode providers

An opencode chat runs on whichever provider you have connected to opencode (Anthropic, OpenAI, OpenRouter, GitHub Copilot, and others). The provider manager shows what is connected and lets you connect more without leaving the app.

To open it, click the model word in the chat's controls row under the composer, then choose the `opencode` connector. The manager fills the model dialog's right column beneath the model list (see [the controls row and model dialog](overview.md#what-does-the-controls-row-do)).
It drives the same `opencode serve` process every opencode chat shares ([Chat providers](providers.md)), through four owner-only core routes.

## What can the manager do?

- Connected. One row per provider opencode reports as connected, with how: `api key`, `oauth` or `env` (an environment variable the server inherited).
- Add a provider. A filterable list of every provider that is not connected yet. An API-key provider takes a pasted key; an OAuth provider opens its sign-in page.
- API key. The key goes to `POST /opencode/auth`, core hands it to opencode's `auth.set`, and opencode writes it to its own credential store. Bismuth never persists it, logs it, or echoes it back: an error from opencode is scrubbed of the key before it reaches the response.
- OAuth: `POST /opencode/oauth/authorize` returns the URL to open and whether the flow is `auto` (opencode finishes when the browser callback lands) or `code` (you paste a code); `POST /opencode/oauth/callback` finishes it.
- New models appear at once. After a successful connect, core re-sends the model list and credential state to every live opencode chat, so the new provider's models show in the model dialog (grouped under the provider's name) without reopening the chat.

Route shapes, status codes and error bodies are in the [HTTP reference](../api/http-reference.md#opencode-provider-manager-opencode).

## Can I chat for free without an account?

Yes. opencode's Zen service offers a rotating roster of free models that answer without a sign-in, so you can chat with no coding agent installed. On the chat setup screen, `[set up free agent]` downloads opencode into `~/.bismuth/agents/bin` and makes Zen Free (rotating) the default model.
`bismuth backends setup-free` does the same from a shell.

Some free models keep prompts, and the setup screen says so. opencode controls which models are free and can change that at any time; if a free turn is answered with a 401, it appears as a normal turn error.
The background [daemon](../daemon/overview.md) still needs Claude Code or Codex, because opencode has no daemon surface.

## What if opencode is not installed?

The routes answer `409 { error: "opencode-missing" }` when the `opencode` binary is absent or its server will not start. The manager shows that message in place of the lists; the terminal footer still works.

## How do I disconnect a provider?

The manager has no disconnect button. Disconnecting, custom providers, and any provider that needs several prompts go through `opencode auth login` and `opencode auth logout` in a terminal; the manager's footer opens a terminal tab or copies the command.
Credentials written that way show up the next time the manager opens.

## Where is the local model?

A local model is configured in `.settings`, not connected here. When [`localModel`](local-models.md) is on, opencode carries a `local` provider that Bismuth injects at spawn time, and the manager filters it out of both lists.

## How it works

The manager is `OpencodeProviderManager`, hosted by `ChatModelPicker`.
It calls `GET /opencode/providers`, `POST /opencode/auth`, `POST /opencode/oauth/authorize` and `POST /opencode/oauth/callback`, each served over the shared `opencode serve` client and refused to non-owner callers. opencode's SDK has no auth-remove call and `opencode auth logout` is an interactive wizard, which is why disconnecting is terminal-only.

The injected `local` provider rides `OPENCODE_CONFIG_CONTENT`. When the local config changes, the shared server is replaced: immediately when no opencode turn is running, otherwise once the running turn settles, so a turn is never cut off mid-answer.

Source: `app/src/chat/OpencodeProviderManager.tsx`, `app/src/chat/opencodeProviderFilter.ts`, `core/src/routes/agents.ts`, `core/src/chatProviders/opencode/opencodeProviders.ts`, `core/src/chatProviders/opencode/opencodeServer.ts`, `core/src/freeAgent.ts`
