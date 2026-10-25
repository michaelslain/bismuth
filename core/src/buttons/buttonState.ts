// core/src/buttons/buttonState.ts
//
// Core's half of a daemon button press: the sidecar store at <vault>/.daemon/buttons/.state and the
// trigger the daemon polls at .daemon/buttons/.triggers. Mirrors daemonPages.ts. Core writes only
// `working`; the daemon writes `done` / `failed`. Server-only (node:fs), unlike buttonBlock.ts.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { writeFileAtomicSync } from '../atomicWrite'
import { readDaemonEnabledSync } from '../settings'
import { writeTrigger } from '../writeTrigger'
import {
    buttonKey,
    hostString,
    parseButtonBlock,
    scanButtonFences,
} from './buttonBlock'
import type { ButtonState, PressRequest, PressResult } from './buttonTypes'

const KEY_RE = /^[0-9a-f]{16}$/
const STALE_GRACE_SECS = 60

/** `<vault>/.daemon/buttons` — the daemon's buttons dir. */
function buttonsDir(vault: string): string {
    return join(vault, '.daemon', 'buttons')
}

/** Dot-prefixed sidecar dir, hidden from the sidebar and the watcher's graph paths like pages'. */
export function buttonStateDir(vault: string): string {
    return join(buttonsDir(vault), '.state')
}

/** Trigger dir the daemon polls (`writeTrigger` drops into `<buttonsDir>/.triggers`). */
export function buttonTriggerDir(vault: string): string {
    return join(buttonsDir(vault), '.triggers')
}

function stateFile(vault: string, key: string): string {
    return join(buttonStateDir(vault), `${key}.json`)
}

function readState(vault: string, key: string): ButtonState | null {
    try {
        return JSON.parse(
            readFileSync(stateFile(vault, key), 'utf8'),
        ) as ButtonState
    } catch {
        return null
    }
}

/** The stored states for `keys`; a key with a missing or unreadable file is absent. */
export function readButtonStates(
    vault: string,
    keys: string[],
): Record<string, ButtonState> {
    const out: Record<string, ButtonState> = {}
    for (const key of keys) {
        if (!KEY_RE.test(key)) continue
        const state = readState(vault, key)
        if (state) out[key] = state
    }
    return out
}

/** The prompt the daemon runs: the button's text, a blank line, `---`, then where it was pressed. */
function composePrompt(prompt: string, hostLine: string): string {
    return `${prompt}\n\n---\n${hostLine}`
}

function refuse(
    reason: 'running' | 'not-found' | 'invalid' | 'daemon-off',
    message: string,
): PressResult {
    return { ok: false, reason, message }
}

/** Press the prompt button at `req.index`: validates, writes `working` and drops the trigger. A
 *  refusal is a result, not a throw. */
export function pressButton(vault: string, req: PressRequest): PressResult {
    if (!readDaemonEnabledSync(vault))
        return refuse('daemon-off', 'the daemon is off for this vault')

    if (req.host.kind === 'note') {
        const full = resolve(vault, req.host.path)
        const rel = relative(resolve(vault), full)
        let markdown = ''
        const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
        if (inside && existsSync(full)) {
            try {
                markdown = readFileSync(full, 'utf8')
            } catch {
                markdown = ''
            }
        }
        if (!scanButtonFences(markdown).some(f => f.body === req.body))
            return refuse('not-found', `no such button in ${req.host.path}`)
    }

    const block = parseButtonBlock(req.body)
    const spec = Number.isInteger(req.index)
        ? block.buttons[req.index]
        : undefined
    if (block.error) return refuse('invalid', block.error)
    if (!spec || spec.action.type !== 'prompt')
        return refuse('invalid', 'not a prompt button')

    const key = buttonKey(req.host, req.body, req.index)
    const prev = readState(vault, key)
    if (
        prev?.status === 'working' &&
        Date.now() - Date.parse(prev.pressedAt) <=
            (prev.timeoutSecs + STALE_GRACE_SECS) * 1000
    )
        return refuse('running', 'already running')

    const hostLine =
        req.host.kind === 'note'
            ? `This button is in the note ${req.host.path}.`
            : 'This button was pressed in a chat.'
    const state: ButtonState = {
        status: 'working',
        host: hostString(req.host),
        label: spec.label,
        prompt: composePrompt(spec.action.prompt, hostLine),
        model: spec.action.model,
        timeoutSecs: spec.action.timeoutSecs,
        pressedAt: new Date().toISOString(),
        completedAt: null,
        note: null,
    }
    const file = stateFile(vault, key)
    mkdirSync(dirname(file), { recursive: true })
    writeFileAtomicSync(file, JSON.stringify(state, null, 2))
    writeTrigger(buttonsDir(vault), key)
    return { ok: true, key, state }
}
