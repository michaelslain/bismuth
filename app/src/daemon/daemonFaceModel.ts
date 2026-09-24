// app/src/daemon/daemonFaceModel.ts
// The pure model behind <DaemonFace> (named daemonFaceModel, not daemonFace: on a case-insensitive
// filesystem './daemonFace' and './DaemonFace' are the same path and the component import would
// resolve here). It decides which mood the daemon is in, and which eight characters
// it shows at a given moment. No Solid imports — the component only owns the clocks (tick,
// blink, hover, wink) and asks this module what to draw, so every frame is unit-testable.
//
// The face is exactly `.:[00]:.`. Alive-ness is character swaps inside fixed cells, never reflow,
// and it lives in the EYES only: they blink (`00` → `--`), scan while busy (`=-` `==` `-=` `==`),
// sleep (`..`), and so on. The side dots (the "hands", `.:` and `:.`) and the brackets never move —
// the user asked for the hands to stay still, after both a per-tick flip and a slow breath read
// as fidgeting.

export type DaemonMood =
    | 'asleep' // daemon disabled or not running
    | 'idle'
    | 'busy' // a cron running or an inbox page mid-run
    | 'alert' // inbox has pages needing review
    | 'hurt' // a cron failed in the last 30 minutes
    | 'listening' // the user is typing in the daemon chat
    | 'thinking' // the daemon chat is busy but no reply text has streamed yet
    | 'talking' // the daemon chat is streaming a reply

export type MoodInput = {
    enabled: boolean
    running: boolean
    cronsRunning: number
    recentFailure: boolean
    inboxDue: number
    inboxWorking: boolean
    chatBusy: boolean
    composing: boolean
    /** Text is actively streaming into the reply. Absent (or false) while a reply is pending —
     *  that reads as `thinking`, not `talking`. */
    chatSpeaking?: boolean
}

/** Exactly 8 cells: [0..2] left side, [3..4] eyes, [5..7] right side. Index 2 is always '[' and 5 always ']'. */
export type FaceFrame = readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
]

export const FACE_REST: FaceFrame = ['.', ':', '[', '0', '0', ']', ':', '.']

/** How long one blink holds the eyes shut. */
export const BLINK_MS = 110
/** Open-eye gap between the two blinks of a double blink. */
export const DOUBLE_BLINK_GAP_MS = 160
// Both of the above are EXEMPT from the >=600ms-per-frame rule TICK_MS enforces below — a blink
// this fast still reads as a blink, and slowing it down to match everything else here would read
// as sleepy rather than calm (user ruling 2026-09-23).
/** How long a click-wink (`0-`) holds. */
export const WINK_MS = 300

/** First match wins — see the priority list in the daemon page plan. */
export function deriveMood(i: MoodInput): DaemonMood {
    if (!i.enabled || !i.running) return 'asleep'
    if (i.chatBusy) return i.chatSpeaking ? 'talking' : 'thinking'
    if (i.composing) return 'listening'
    if (i.recentFailure) return 'hurt'
    if (i.cronsRunning > 0 || i.inboxWorking) return 'busy'
    if (i.inboxDue > 0) return 'alert'
    return 'idle'
}

type Sides = readonly [string, string, string, string]

/** The hands: `.:[ … ]:.` in every mood and every frame. */
const SIDES: Sides = ['.', ':', ':', '.']

const BUSY_SCAN = ['=-', '==', '-=', '=='] as const
const TALK = ['0o', 'o0'] as const
// A slow, symmetric pulse — soft eyes easing toward a rest-like `..` and back, never the idle
// `00`, the talking `0o`/`o0` mouth-flip, or a real blink (`--`, a dash, not a dot). Reads as
// "considering", not busy: both frames are calm and even, so nothing about it looks like chatter.
const THINK = ['oo', '..'] as const

function eyesFor(mood: DaemonMood, tick: number): string {
    switch (mood) {
        case 'asleep':
            return '..'
        case 'hurt':
            return '><'
        case 'alert':
            return 'OO'
        case 'busy':
            return BUSY_SCAN[tick % 4]
        case 'talking':
            return TALK[tick % 2]
        case 'thinking':
            return THINK[tick % 2]
        case 'idle':
        case 'listening':
            return '00'
    }
}

/** True when a blink is allowed to close this mood's eyes. */
export function canBlink(mood: DaemonMood): boolean {
    return mood !== 'asleep' && mood !== 'hurt'
}

function build(sides: Sides, eyes: string): FaceFrame {
    return [sides[0], sides[1], '[', eyes[0], eyes[1], ']', sides[2], sides[3]]
}

/** `tick` drives the eyes (the mood's `tickMs` clock). The sides are fixed. */
export function faceFrame(
    mood: DaemonMood,
    tick: number,
    blinking: boolean,
): FaceFrame {
    const t = Math.max(0, Math.floor(tick))
    const eyes = blinking && canBlink(mood) ? '--' : eyesFor(mood, t)
    return build(SIDES, eyes)
}

export type FaceInteraction = {
    blinking: boolean
    hovered: boolean
    winking: boolean
}

/**
 * The frame the component actually paints: `faceFrame` plus the pointer overlays. A click-wink
 * (`0-`) beats everything; a blink beats hover (so the face still blinks while you look at it);
 * hover opens the eyes wide (`OO`). None of the overlays wake a sleeping face.
 */
export function composeFace(
    mood: DaemonMood,
    tick: number,
    state: FaceInteraction,
): FaceFrame {
    if (mood === 'asleep') return faceFrame(mood, tick, false)
    const shut = state.blinking && canBlink(mood) && !state.winking
    const base = faceFrame(mood, tick, shut)
    if (state.winking) return build(SIDES, '0-')
    if (shut) return base
    if (state.hovered) return build(SIDES, 'OO')
    return base
}

/** The EYE clock per mood. Idle/alert/listening/hurt/asleep eyes hold still between blinks, so
 *  their tick only restarts the frame; busy scans, talking mouths and thinking's soft pulse are the
 *  ones that move. Every value is >= 600ms — anything faster read as flicker, not liveness — so
 *  busy (was 260ms) and talking (was 240ms) both slowed down; talking still ticks a bit faster than
 *  the rest so a streaming reply reads as more active than a calm think. */
const TICK_MS: Record<DaemonMood, number> = {
    asleep: 2400,
    idle: 1600,
    alert: 900,
    listening: 1200,
    busy: 700,
    talking: 640,
    thinking: 900,
    hurt: 1600,
}

export function tickMs(mood: DaemonMood): number {
    return TICK_MS[mood]
}

export function nextBlinkDelay(
    mood: DaemonMood,
    rand: () => number,
): { delayMs: number; double: boolean } {
    if (mood === 'asleep') return { delayMs: Infinity, double: false }
    const delayMs =
        mood === 'alert' ? 1200 + rand() * 2000 : 2200 + rand() * 4200
    return { delayMs, double: rand() < 0.15 }
}

const LABEL: Record<DaemonMood, string> = {
    asleep: 'asleep',
    idle: 'watching',
    busy: 'working',
    alert: 'needs you',
    hurt: 'hurt',
    listening: 'listening',
    talking: 'talking',
    thinking: 'thinking',
}

export function moodLabel(mood: DaemonMood): string {
    return LABEL[mood]
}

// ── Mood settle ──────────────────────────────────────────────────────────────────────────────
// The raw derived mood can flip several times a second (a poll, a keystroke). The face should
// only ever show a mood that has HELD for MOOD_SETTLE_MS — this is the hysteresis. Pure: the
// component supplies `nowMs` (wall clock) on every prop change and on a timer for the pending
// deadline, never a sleep.

/** How long a new mood must hold before the face actually shows it. */
export const MOOD_SETTLE_MS = 1500

export type SettleState = {
    /** The mood currently painted. */
    shown: DaemonMood
    /** A candidate mood waiting to hold long enough to become `shown`; null when nothing is pending. */
    pending: DaemonMood | null
    /** When `pending` started being considered (ms, same clock as `nowMs`). */
    since: number
}

/** Shows the first mood immediately — there is nothing to settle against yet. */
export function initialSettle(mood: DaemonMood, nowMs: number): SettleState {
    return { shown: mood, pending: null, since: nowMs }
}

/** Feed the latest raw mood + the current time in. `pending` restarts every time `next` changes to
 *  something new; `shown` only flips to `pending` once it has held `MOOD_SETTLE_MS` without
 *  changing; `next === shown` just clears any stale pending. */
export function settleMood(
    s: SettleState,
    next: DaemonMood,
    nowMs: number,
): SettleState {
    if (next === s.shown)
        return s.pending === null
            ? s
            : { shown: s.shown, pending: null, since: s.since }
    if (next !== s.pending) return { shown: s.shown, pending: next, since: nowMs }
    if (nowMs - s.since >= MOOD_SETTLE_MS)
        return { shown: next, pending: null, since: nowMs }
    return s
}
