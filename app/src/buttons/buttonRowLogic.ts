// app/src/buttons/buttonRowLogic.ts
// Pure text/decision helpers for a button row: the status line under it, the confirm wording and
// which presses ask for trust. No framework imports.
import type { ButtonAction, ButtonHost, ButtonState } from '../../../core/src/buttons/buttonTypes'

/** A `working` state older than `timeoutSecs` + this reads as a dead job. */
export const STALE_GRACE_SECS = 60

const NOTE_MAX = 80

export type StatusLine = {
    text: string
    tone: 'muted' | 'danger'
    /** The whole note, for a tooltip, when the line shows only part of it. */
    full?: string
}

export function agoLabel(then: number, now: number): string {
    const secs = Math.max(0, Math.round((now - then) / 1000))
    if (secs < 45) return 'just now'
    const mins = Math.round(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
}

/** True when a `working` state has outlived its job. */
export function isStale(state: ButtonState, now: number): boolean {
    return (
        state.status === 'working' &&
        now - Date.parse(state.pressedAt) > (state.timeoutSecs + STALE_GRACE_SECS) * 1000
    )
}

function firstLine(note: string): string {
    const line = note.split('\n').find(l => l.trim()) ?? ''
    const t = line.trim()
    return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX)}…` : t
}

export function statusLine(state: ButtonState | null, now: number): StatusLine | null {
    if (!state) return null
    if (state.status === 'working') {
        if (isStale(state, now)) {
            return {
                text: `failed // no response from the daemon // ${agoLabel(Date.parse(state.pressedAt), now)}`,
                tone: 'danger',
            }
        }
        return { text: 'working…', tone: 'muted' }
    }
    const when = agoLabel(Date.parse(state.completedAt ?? state.pressedAt), now)
    const head = state.note ? firstLine(state.note) : ''
    const parts = [state.status, ...(head ? [head] : []), when]
    return {
        text: parts.join(' // '),
        tone: state.status === 'failed' ? 'danger' : 'muted',
        ...(state.note && state.note !== head ? { full: state.note } : {}),
    }
}

export function trustText(action: ButtonAction): string {
    return action.type === 'prompt' ? action.prompt : action.type === 'send' ? action.text : ''
}

/** What a trust entry is keyed on: the action type plus every field that changes what runs. */
export function trustKey(a: ButtonAction): string {
    return a.type === 'prompt'
        ? `prompt\n${a.model}\n${a.timeoutSecs}\n${a.prompt}`
        : a.type === 'send'
          ? `send\n${a.text}`
          : ''
}

export function confirmLine(action: ButtonAction): string {
    if (action.type === 'prompt') return `run this? ${action.prompt}`
    if (action.type === 'send') return `send this? ${action.text}`
    return ''
}

/** Only a note's prompt or send button asks first; chat and command buttons never do. */
export function needsTrust(host: ButtonHost, action: ButtonAction): boolean {
    return host.kind === 'note' && action.type !== 'command'
}
