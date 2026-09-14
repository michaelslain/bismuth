// app/src/daemon/daemonFaceModel.ts
// The pure model behind <DaemonFace> (named daemonFaceModel, not daemonFace: on a case-insensitive
// filesystem './daemonFace' and './DaemonFace' are the same path and the component import would
// resolve here). It decides which mood the daemon is in, and which eight characters
// it shows at a given moment. No Solid imports — the component only owns the clocks (tick,
// blink, hover, wink) and asks this module what to draw, so every frame is unit-testable.
//
// The face is exactly `.:[00]:.`. Alive-ness is character swaps inside fixed one-`ch` cells,
// never reflow: the sides "breathe" (`.:[` ↔ `:.[`), the eyes blink (`00` → `--`), scan while
// busy (`=-` `==` `-=` `==`), sleep (`..`), and so on. The brackets never move.

export type DaemonMood =
    | 'asleep' // daemon disabled or not running
    | 'idle'
    | 'busy' // a cron running or an inbox page mid-run
    | 'alert' // inbox has pages needing review
    | 'hurt' // a cron failed in the last 30 minutes
    | 'listening' // the user is typing in the daemon chat
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
/** How long a click-wink (`0-`) holds. */
export const WINK_MS = 300

/** First match wins — see the priority list in the daemon page plan. */
export function deriveMood(i: MoodInput): DaemonMood {
    if (!i.enabled || !i.running) return 'asleep'
    if (i.chatBusy) return 'talking'
    if (i.composing) return 'listening'
    if (i.recentFailure) return 'hurt'
    if (i.cronsRunning > 0 || i.inboxWorking) return 'busy'
    if (i.inboxDue > 0) return 'alert'
    return 'idle'
}

type Sides = readonly [string, string, string, string]

const SIDES_REST: Sides = ['.', ':', ':', '.'] // .:[ … ]:.
const SIDES_BREATH: Sides = [':', '.', '.', ':'] // :.[ … ].:
const SIDES_LISTEN: Sides = [':', ':', ':', ':'] // ::[ … ]::

const BUSY_SCAN = ['=-', '==', '-=', '=='] as const
const TALK = ['0o', 'o0'] as const

function sidesFor(mood: DaemonMood, tick: number): Sides {
    if (mood === 'asleep' || mood === 'hurt') return SIDES_REST
    if (mood === 'listening') return SIDES_LISTEN
    return tick % 2 === 0 ? SIDES_REST : SIDES_BREATH
}

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

export function faceFrame(
    mood: DaemonMood,
    tick: number,
    blinking: boolean,
): FaceFrame {
    const t = Math.max(0, Math.floor(tick))
    const eyes = blinking && canBlink(mood) ? '--' : eyesFor(mood, t)
    return build(sidesFor(mood, t), eyes)
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
    if (state.winking) return build(sidesOf(base), '0-')
    if (shut) return base
    if (state.hovered) return build(sidesOf(base), 'OO')
    return base
}

function sidesOf(f: FaceFrame): Sides {
    return [f[0], f[1], f[6], f[7]]
}

const TICK_MS: Record<DaemonMood, number> = {
    asleep: 2400,
    idle: 1400,
    alert: 900,
    listening: 1100,
    busy: 260,
    talking: 180,
    hurt: 1400,
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
}

export function moodLabel(mood: DaemonMood): string {
    return LABEL[mood]
}
