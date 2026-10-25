# Buttons

A ` ```button ` fence puts clickable buttons in a note or a chat reply. A button runs a background job on the daemon, sends a message, or runs an app command. Read this page to add buttons to a note, or to write them from an agent.

```button
- label: summarize this week
  kind: primary
  prompt: Summarize what changed in this note this week and append it under ## Week.
  model: sonnet
- label: open daemon
  command: open-daemon
```

The fence holds one button (a YAML mapping) or a row of buttons (a YAML list). Each button is drawn as a bracket chip with its label in lowercase: `[open daemon] [summarize this week]`. A `primary` button always sits last in its row.

## Button keys

Every button has a `label`, an optional `kind` and exactly one action key.

| Key | Required | Effect |
|---|---|---|
| `label` | yes | The chip's text, shown lowercase. |
| `kind` | no | `primary`, `default` or `danger`. Defaults to `default`. `danger` uses the danger tone and `primary` the accent tone. |
| `prompt` | one action | Runs the text as a daemon job. |
| `send` | one action | Sends the text as a message. |
| `command` | one action | Runs the app command with this id. |
| `model` | no | With `prompt` only. The model the job runs on. Defaults to `haiku`. |
| `timeout` | no | With `prompt` only. Seconds the job may run. Defaults to `300`. |

A button with none of the three actions, or with more than one, is invalid.

## The three actions

A `prompt` button starts a fresh background session on the daemon, the way an approved [inbox page](../daemon/pages.md) does. The session gets the button's prompt followed by where it was pressed: the note's path, or a line saying it came from a chat. The result returns as the button's status.

A `send` button sends its text as your next message. In a chat reply the text goes into that same conversation, and it queues like a follow-up while a reply is still streaming. In a note it opens the quick-ask popover at the button's line and sends the text as the first message.

A `command` button runs the app command with that id from the command catalog; the ids are listed in [toolbar commands](../settings/toolbar-commands.md). Commands that open windows, update the app or start a chat (`new-window`, `open-folder`, `update-app`, `daemon-update`, `new-claude-chat`, `quick-ask`) are refused, and the fence reads as invalid.

## Where buttons work

Buttons are live in two places: the note editor, and assistant messages in a chat. A [daemon inbox page](../daemon/pages.md) opens in the note editor, so a fence in a page's body is live too, beside the page's own action chips. A button in a message you wrote stays plain text. Cards, transclusions and exports show a button as inert muted text such as `[open daemon] [summarize this week]`.

In the editor the fence is drawn as the row in place of the source. Double-click it to show the source, as for a [query block](../bases/query-block.md).

## Confirm before running

A `prompt` or `send` button in a note asks before it acts the first time, because anyone can put text in a note. The status line becomes `run this?` followed by the whole prompt, in a box that scrolls once it passes six lines, then a muted `<model> // <timeout>s` line such as `haiku // 300s`, then `[run]` and `[cancel]`. A send button shows `send this?`, its whole text, and `[send]` `[cancel]`, with no model line.

`[cancel]` or Escape restores the row. `[run]` acts and remembers that button on this device, so it does not ask again. Changing its text, its action, its model or its timeout asks again.

Buttons in a chat and `command` buttons never ask.

## Statuses

A prompt button shows its progress after the row.

| Line | Meaning |
|---|---|
| `working…` | The daemon is running the job. The chip is disabled. |
| `done // <first line of the result> // 2m ago` | The job finished. Hover the line for the whole result. |
| `failed // <reason> // 2m ago` | The job failed or timed out. A job that has been working longer than its timeout plus a minute reads `failed // no response from the daemon`. |
| `daemon is off` | The daemon is disabled for this vault. The chip is disabled; `send` and `command` chips stay live. |
| `this device isn't the daemon owner — pressing here won't run` | Shown above the row on a device that does not own the daemon. Prompt chips are disabled. |
| `button // <what is wrong>` | The fence is invalid, for example `button // needs exactly one of prompt, send, command`. |

A `done` or `failed` button can be pressed again. A `working` one cannot.

The status belongs to the fence: editing the fence's text starts the button idle again. Buttons with the same text in different notes keep separate statuses, and identical fences in one note or one chat share a status.

A press from a note saves the note first, so a fence you just edited is pressed as you see it.

## Write buttons from an agent

Read this page before adding a button to a note or a chat reply. Put the fence in the reply or note body:

```button
label: archive the inbox
kind: danger
prompt: Move every read page in the daemon inbox to the trash.
timeout: 120
```

- Make `prompt` text complete on its own. The job runs in a fresh session with no memory of the conversation.
- Use `send` for a follow-up question the reader is likely to ask next.
- Use `command` only with an id from the catalog, and not one of the refused ids.
- Keep each label short and unique within the note, so the CLI can press it by name.

## Use the CLI

`bismuth button list <note>` prints the note's buttons as JSON: `fence`, `index`, `label`, `type`, `key` and `status` (`idle` until pressed). An invalid fence is one entry with an `error`.

`bismuth button press <note> <label>` presses a prompt button by its label, matched without regard to case. It prints the result and exits `1` when the press is refused. A label that matches no button is refused with the labels the note has; a label that matches several is refused with their fence numbers; a `send` or `command` button is refused because it runs in the app. The note path is vault-relative. The full flags are in the [CLI reference](../cli/reference.md#button).

## How it works

`parseButtonBlock` turns a fence body into buttons or an error, and `scanButtonFences` finds the fences in a markdown string. Both are pure, so the app and the daemon-side code share them. `buttonKey` hashes the host (`note:<path>` or `chat:<chatId>`), the fence body and the button's index into the 16-character key that names the button's state.

`pressButton` validates the press, writes `<vault>/.daemon/buttons/.state/<key>.json` with status `working`, and drops a trigger file in `<vault>/.daemon/buttons/.triggers/`. It refuses with a result, never a throw, when the daemon is off, the note has no such fence, the button is not a prompt button, or the button is already working. The composed prompt is the button's text, a blank line, `---`, and the line saying where it was pressed.

The daemon polls the trigger directory, deletes each trigger before processing it, runs the stored prompt in a fresh session and writes `done` or `failed` into the state file. The runtime writes the completion, never the model.

The app routes are `POST /buttons/press` and `POST /buttons/states`, which returns the stored states for a list of keys; both answer `403` without the owner token. A rejected press shows as `failed // <message>` on the row. The editor widget mounts the same row component the chat bubble uses. Trust for note buttons is kept in the device's app storage.

Source: `core/src/buttons/buttonBlock.ts`, `core/src/buttons/buttonState.ts`, `core/src/routes/daemon.ts`, `daemon/src/daemon/buttons.ts`, `app/src/buttons/ButtonBlockView.tsx`, `app/src/buttons/ButtonRow.tsx`, `app/src/editor/buttonBlock.ts`, `cli/src/commands/button.ts`
