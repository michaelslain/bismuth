import { test, expect } from 'bun:test'
import {
    composeFace,
    deriveMood,
    moodLabel,
    faceFrame,
    nextBlinkDelay,
    tickMs,
    initialSettle,
    settleMood,
    MOOD_SETTLE_MS,
    FACE_REST,
    type DaemonMood,
    type MoodInput,
} from './daemonFaceModel'

const MOODS: DaemonMood[] = [
    'asleep',
    'idle',
    'busy',
    'alert',
    'hurt',
    'listening',
    'talking',
    'thinking',
]
const base: MoodInput = {
    enabled: true,
    running: true,
    cronsRunning: 0,
    recentFailure: false,
    inboxDue: 0,
    inboxWorking: false,
    chatBusy: false,
    composing: false,
}

test('rest face is exactly .:[00]:.', () => {
    expect(FACE_REST.join('')).toBe('.:[00]:.')
})

test('every frame is 8 cells with the brackets pinned', () => {
    for (const m of MOODS)
        for (let t = 0; t < 8; t++)
            for (const b of [false, true]) {
                const f = faceFrame(m, t, b)
                expect(f.length).toBe(8)
                expect(f.every(c => c.length === 1)).toBe(true)
                expect(f[2]).toBe('[')
                expect(f[5]).toBe(']')
            }
})

test('idle at tick 0 is the rest face, and blinking closes the eyes', () => {
    expect(faceFrame('idle', 0, false).join('')).toBe('.:[00]:.')
    expect(faceFrame('idle', 0, true).join('')).toBe('.:[--]:.')
})

test('the hands never move: every mood, tick, blink and pointer state keeps .: and :.', () => {
    for (const m of MOODS)
        for (let t = 0; t < 8; t++)
            for (const b of [false, true]) {
                const f = faceFrame(m, t, b)
                expect([f[0], f[1], f[6], f[7]].join('')).toBe('.::.')
                for (const hovered of [false, true])
                    for (const winking of [false, true]) {
                        const c = composeFace(m, t, {
                            blinking: b,
                            hovered,
                            winking,
                        })
                        expect([c[0], c[1], c[6], c[7]].join('')).toBe('.::.')
                    }
            }
})

test('asleep and hurt ignore blinks', () => {
    expect(faceFrame('asleep', 1, true).join('')).toBe('.:[..]:.')
    expect(faceFrame('hurt', 1, true).join('')).toBe('.:[><]:.')
})

test('busy scans', () => {
    expect(
        [0, 1, 2, 3].map(t => faceFrame('busy', t, false).slice(3, 5).join('')),
    ).toEqual(['=-', '==', '-=', '=='])
})

test('thinking is calm and distinct from talking and idle', () => {
    expect(moodLabel('thinking')).toBe('thinking')
    const thinking0 = faceFrame('thinking', 0, false).slice(3, 5).join('')
    const thinking1 = faceFrame('thinking', 1, false).slice(3, 5).join('')
    const talking0 = faceFrame('talking', 0, false).slice(3, 5).join('')
    const talking1 = faceFrame('talking', 1, false).slice(3, 5).join('')
    expect(thinking0).not.toBe(talking0)
    expect(thinking1).not.toBe(talking1)
    expect(thinking0).not.toBe('00')
})

test('mood priority', () => {
    expect(
        deriveMood({
            ...base,
            running: false,
            chatBusy: true,
            chatSpeaking: true,
        }),
    ).toBe('asleep')
    expect(deriveMood({ ...base, enabled: false })).toBe('asleep')
    expect(
        deriveMood({
            ...base,
            chatBusy: true,
            chatSpeaking: true,
            composing: true,
            recentFailure: true,
        }),
    ).toBe('talking')
    expect(
        deriveMood({
            ...base,
            chatBusy: true,
            chatSpeaking: false,
            composing: true,
            recentFailure: true,
        }),
    ).toBe('thinking')
    // chatSpeaking absent defaults to false, so a busy chat with no streamed text reads as thinking
    expect(deriveMood({ ...base, chatBusy: true })).toBe('thinking')
    expect(deriveMood({ ...base, composing: true, recentFailure: true })).toBe(
        'listening',
    )
    expect(deriveMood({ ...base, recentFailure: true, cronsRunning: 2 })).toBe(
        'hurt',
    )
    expect(deriveMood({ ...base, inboxWorking: true, inboxDue: 3 })).toBe(
        'busy',
    )
    expect(deriveMood({ ...base, inboxDue: 1 })).toBe('alert')
    expect(deriveMood(base)).toBe('idle')
})

test('blink scheduling', () => {
    expect(nextBlinkDelay('asleep', () => 0.5).delayMs).toBe(Infinity)
    expect(nextBlinkDelay('idle', () => 0).delayMs).toBe(2200)
    expect(nextBlinkDelay('idle', () => 0.1).double).toBe(true)
    expect(nextBlinkDelay('idle', () => 0.9).double).toBe(false)
    expect(tickMs('talking')).toBeLessThan(tickMs('idle'))
})

test('the other moods draw their pinned eyes and sides', () => {
    expect(faceFrame('alert', 0, false).join('')).toBe('.:[OO]:.')
    expect(faceFrame('alert', 1, false).join('')).toBe('.:[OO]:.')
    expect(faceFrame('listening', 0, false).join('')).toBe('.:[00]:.')
    expect(faceFrame('listening', 1, true).join('')).toBe('.:[--]:.')
    expect(faceFrame('talking', 0, false).join('')).toBe('.:[0o]:.')
    expect(faceFrame('talking', 1, false).join('')).toBe('.:[o0]:.')
    expect(faceFrame('busy', 2, true).join('')).toBe('.:[--]:.')
    expect(faceFrame('thinking', 0, false).join('')).toBe('.:[oo]:.')
    expect(faceFrame('thinking', 1, false).join('')).toBe('.:[..]:.')
})

test('every tick is at least 600ms', () => {
    for (const m of MOODS) expect(tickMs(m)).toBeGreaterThanOrEqual(600)
})

test('tick cadence per mood', () => {
    expect(MOODS.map(tickMs)).toEqual([
        2400, 1600, 700, 900, 1600, 1200, 640, 900,
    ])
})

test('alert blinks sooner, and asleep never blinks double', () => {
    expect(nextBlinkDelay('alert', () => 0).delayMs).toBe(1200)
    expect(nextBlinkDelay('alert', () => 0.999).delayMs).toBeLessThan(3200)
    expect(nextBlinkDelay('asleep', () => 0).double).toBe(false)
})

test('mood labels', () => {
    expect(MOODS.map(moodLabel)).toEqual([
        'asleep',
        'watching',
        'working',
        'needs you',
        'hurt',
        'listening',
        'talking',
        'thinking',
    ])
})

test('pointer overlays: wink beats blink beats hover, and none wake a sleeper', () => {
    const rest = { blinking: false, hovered: false, winking: false }
    expect(composeFace('idle', 0, rest).join('')).toBe('.:[00]:.')
    expect(composeFace('idle', 0, { ...rest, hovered: true }).join('')).toBe(
        '.:[OO]:.',
    )
    expect(
        composeFace('idle', 0, { ...rest, hovered: true, blinking: true }).join(
            '',
        ),
    ).toBe('.:[--]:.')
    expect(
        composeFace('idle', 0, {
            hovered: true,
            blinking: true,
            winking: true,
        }).join(''),
    ).toBe('.:[0-]:.')
    expect(
        composeFace('asleep', 0, {
            hovered: true,
            blinking: true,
            winking: true,
        }).join(''),
    ).toBe('.:[..]:.')
    // hurt ignores blinks, so hovering it holds OO straight through a blink
    expect(
        composeFace('hurt', 0, { ...rest, hovered: true, blinking: true }).join(
            '',
        ),
    ).toBe('.:[OO]:.')
    expect(composeFace('hurt', 0, rest).join('')).toBe('.:[><]:.')
})

// ── Mood settle ────────────────────────────────────────────────────────────────────────────

test('settle: the first mood is shown immediately', () => {
    const s = initialSettle('idle', 1000)
    expect(s).toEqual({ shown: 'idle', pending: null, since: 1000 })
})

test('settle: a flip-flop burst under 1.5s never changes what is shown', () => {
    let s = initialSettle('idle', 0)
    s = settleMood(s, 'busy', 100)
    expect(s.shown).toBe('idle')
    s = settleMood(s, 'idle', 200)
    expect(s.pending).toBeNull()
    s = settleMood(s, 'busy', 300)
    s = settleMood(s, 'idle', 400)
    s = settleMood(s, 'busy', 1400)
    expect(s.shown).toBe('idle')
})

test('settle: a held change shows at exactly MOOD_SETTLE_MS, not before', () => {
    let s = initialSettle('idle', 0)
    s = settleMood(s, 'busy', 0)
    expect(s.shown).toBe('idle')
    s = settleMood(s, 'busy', MOOD_SETTLE_MS - 1)
    expect(s.shown).toBe('idle')
    s = settleMood(s, 'busy', MOOD_SETTLE_MS)
    expect(s.shown).toBe('busy')
})

test('settle: next equal to shown clears pending, and a later hold restarts the full wait', () => {
    let s = initialSettle('idle', 0)
    s = settleMood(s, 'busy', 0)
    s = settleMood(s, 'idle', 500)
    expect(s.pending).toBeNull()
    s = settleMood(s, 'busy', 600)
    s = settleMood(s, 'busy', 600 + MOOD_SETTLE_MS - 1)
    expect(s.shown).toBe('idle')
    s = settleMood(s, 'busy', 600 + MOOD_SETTLE_MS)
    expect(s.shown).toBe('busy')
})
