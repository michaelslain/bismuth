// core/src/buttons/buttonTypes.ts
//
// The shapes shared by every part of a ```button block: the pure parser (buttonBlock.ts), core's
// press/state store (buttonState.ts + the /buttons routes), the daemon runtime
// (daemon/src/daemon/buttons.ts keeps its own narrower copy of ButtonState, as pages.ts does), the
// CLI, and the app (ButtonRow, ButtonBlockView, the editor widget, the chat bubble). Types only, so
// the app and mobile can import it with no Bun or node:fs on the path.

/** Styling only, as on an inbox page's action. The primary button sits last in its row. */
export type ButtonKind = 'primary' | 'default' | 'danger'

/** What a press does. A button carries exactly one. */
export type ButtonAction =
    /** Run `prompt` as a daemon job: a fresh, isolated background session. */
    | { type: 'prompt'; prompt: string; model: string; timeoutSecs: number }
    /** Send `text` as the user's message: into the same chat, or a note's quick ask. */
    | { type: 'send'; text: string }
    /** Run the app command with this COMMAND_CATALOG id. */
    | { type: 'command'; id: string }

export type ButtonSpec = {
    /** Shown lowercase on the chip. */
    label: string
    kind: ButtonKind
    action: ButtonAction
}

/** A parsed fence: its buttons in source order, or why it is invalid. A fence with an error
 *  renders no buttons, only the error line. */
export type ButtonBlock = {
    buttons: ButtonSpec[]
    error: string | null
}

/** Where a button sits. A note button's prompt names the note; a chat button's does not. */
export type ButtonHost =
    | { kind: 'note'; path: string }
    | { kind: 'chat'; chatId: string }

/** A daemon job's progress. A button with no stored state is idle. */
export type ButtonJobStatus = 'working' | 'done' | 'failed'

/** The sidecar at `<vault>/.daemon/buttons/.state/<key>.json`. Core writes `working`; only the
 *  daemon writes `done` / `failed`. */
export type ButtonState = {
    status: ButtonJobStatus
    /** `hostString(host)` of the press. */
    host: string
    label: string
    /** The resolved prompt the daemon sends, context line included. */
    prompt: string
    model: string
    timeoutSecs: number
    pressedAt: string
    completedAt: string | null
    /** Up to 500 characters of the result, or the failure reason. */
    note: string | null
}

/** A press of the button at `index` (source order) in the fence whose body is `body`. */
export type PressRequest = {
    host: ButtonHost
    body: string
    index: number
}

export type PressResult =
    | { ok: true; key: string; state: ButtonState }
    | {
          ok: false
          /** running: already working · not-found: the note has no such fence · invalid: the
           *  fence does not parse or the button is not a prompt button · daemon-off: the vault's
           *  daemon.enabled is false. */
          reason: 'running' | 'not-found' | 'invalid' | 'daemon-off'
          message: string
      }
