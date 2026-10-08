# Connect an AI agent

An AI agent reaches your vault in one of four ways: in a terminal tab, in the in-app chat, through the MCP server, or as the daemon's own session. This guide gets you from nothing installed to a working chat, then shows how to restrict what agents can read.
If you only want one path, use the in-app chat with Claude Code.

```bash
claude                  # once, in any terminal: install Claude Code and log in
bismuth backends        # confirm Bismuth sees it: a line starting with ✓ claude
```

Then press `Mod+Shift+C` in the app to open a chat.

## Which way should I connect an agent?

The four ways differ in where the agent runs and in what visibility restrictions bind it. They are not exclusive: one vault can use all four.

| Way | Where the agent runs | Use it for | Bound by visibility |
|-----|----------------------|-----------|---------------------|
| Chat | An in-app tab, driven by your installed CLI | Asking, editing and exploring with a rendered transcript | Yes |
| Terminal tab | A real shell in the vault, running `claude` or another CLI | The agent's full interactive interface | No, it runs as you |
| MCP server | Inside any agent CLI that has the server registered | Giving an agent Bismuth's docs and CLI as tools | Follows the session that uses it |
| Daemon | A background service, unattended | Scheduled work and memory | Yes |

- Chat. The agent is your own `claude`, `codex`, `opencode` or another backend ([backends](backends.md)). See [chat](overview.md).
- Terminal tab. In an app terminal, a bare `claude` loads the relay plugin automatically, which reports the session to the app and adds the Bismuth MCP server and memory recall for that session. See [terminal tabs](../terminal/overview.md).
- MCP server. It serves the docs and the `bismuth` CLI as a few small tools. See [MCP](../mcp/overview.md).
- Daemon. It runs its own Claude Code (or Codex) session on a schedule. See [set up the daemon](../daemon/setup.md).

## Set up your first chat

1. Install Claude Code and log in. Run `claude` once in a terminal and follow the prompts. Claude Code uses your own login, so Bismuth asks for no API key.
2. Check that Bismuth finds it. Run `bismuth backends`. The line for `claude` starts with `✓` and shows its version:

   ```text
   ✓ claude           2.1.293 (Claude Code)    chat terminal relay:hooks daemon mcp:cli memory:hooks local
   ```

3. Open a chat. Press `Mod+Shift+C`, or run **New Claude Chat** from the command palette.
4. Send a message, such as `which notes link to my home note?`. The reply streams into the transcript, and tool calls appear as chips with their results.

No Claude Code and no other agent? The chat shows a setup screen with `[set up free agent]`, which installs opencode on free models with no account. See [opencode providers](opencode-providers.md).
To use another installed agent instead, open the model dialog from the model word under the composer and pick its connector, or set `chat.provider` in `.settings` ([backends](backends.md)).

## Verify that the chat can use Bismuth's tools

Type `/mcp` in the chat. Bismuth answers it locally with the MCP servers the session has:

```text
**MCP Servers** (1)

- **bismuth** — connected — <n> tools
```

The line for `bismuth` must read `connected`. If it is missing, the chat session has no Bismuth tools. A chat inherits your Claude Code MCP configuration, and the packaged app registers the server there on launch.
Check the registration with `bismuth install --status` (expect `"mcpRegistered":true`). If it is `false`, run the in-app **Install Bismuth CLI + MCP…** command, then open a new chat.

## Connect an agent in a terminal tab

1. Open a terminal: `` Mod+` `` or **Open Terminal** from the command palette.
2. Run `claude` (or `codex`, `opencode` and so on). The session is registered with the app.
3. From a second tab, run `bismuth relay list`. The session and any subagents appear, with the terminal id and working directory.

The relay only loads for sessions started inside an app terminal. Other CLIs get Bismuth's MCP server on request: list them under `mcp.registerWith` in `.settings`, or run `bismuth install --mcp <cli>` (or `--mcp all`). Only Claude Code is registered automatically.

## Restrict what agents can see

Mark a note or folder so Bismuth's own agents (chat and the daemon) cannot read it. Right-click it in the file tree, open **Visibility**, and pick one of:

- **Visible to Daemon + Chat** clears any restriction.
- **Chat only** lets the chat read it but not the daemon.
- **Hidden from both** keeps it away from the chat and the daemon.

Three things to know before you rely on it:

- Only Claude Code can enforce it for chat. If the vault restricts any note and the chat's backend cannot enforce the restriction, the chat shows a refusal screen instead of running an unprotected agent. The same applies to the daemon, which falls back to Claude.
  The current per-backend table is in [visibility](../vault/visibility.md#per-backendper-channel-enforcement).
- Terminal agents are not restricted. A terminal session is you, with full access to the filesystem. Visibility is an honesty boundary for Bismuth's own agents, not a security boundary.
- Hidden notes leave the editor-context block: The chat leaves a hidden note out of the context it sends with each message, and the `bismuth` CLI returns results with hidden notes omitted when an agent runs it. Details are in [visibility](../vault/visibility.md).

## What goes wrong?

- `bismuth backends` shows `· claude  not installed`: Bismuth did not find the binary on its search path. Install Claude Code, or add its directory to your login shell's `PATH`, then reopen the chat.
- The chat shows `<agent> isn't installed`: The tab's backend has no binary. Use the switch row on that screen, or set `chat.provider` to an installed backend.
- The chat shows a refusal about hidden notes: The vault restricts notes and the chosen backend cannot enforce that. Switch to Claude Code or remove the restriction.
- `/mcp` lists no `bismuth` server: The chat has no Bismuth tools; see the verify step above.
- `bismuth relay list` is empty: The `claude` you ran is not from an app terminal tab, or it ran before the relay loaded. Start `claude` again in a Bismuth terminal.

## How it works

Chat, terminal tabs and the daemon each start the agent CLI themselves and differ in the channel they stamp on it. A chat session sets `BISMUTH_AGENT_CHANNEL=chat` and the daemon sets `daemon`; the `bismuth` CLI and the HTTP routes read that variable to filter hidden notes.
A terminal tab deliberately sets no channel, because whoever types in it is the vault owner. The relay plugin, MCP registration and the backend catalog are described on the pages linked above.

Source: `core/src/agentBackends/catalog.ts`, `core/src/chat.ts`, `core/src/terminal.ts`, `core/src/bismuthInstall.ts`, `core/src/visibilityFilter.ts`, `cli/src/commands/backends.ts`, `cli/src/commands/install.ts`, `cli/src/commands/relay.ts`
