import { test, expect } from 'bun:test'
import {
    composeFace,
    deriveMood,
    moodLabel,
    faceFrame,
    nextBlinkDelay,
    tickMs,
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

test('idle breathes on odd ticks', () => {
    expect(faceFrame('idle', 1, false).join('')).toBe(':.[00].:')
})

test('asleep and hurt ignore blinks and do not breathe', () => {
    expect(faceFrame('asleep', 1, true).join('')).toBe('.:[..]:.')
    expect(faceFrame('hurt', 1, true).join('')).toBe('.:[><]:.')
})

test('busy scans', () => {
    expect(
        [0, 1, 2, 3].map(t => faceFrame('busy', t, false).slice(3, 5).join('')),
    ).toEqual(['=-', '==', '-=', '=='])
})

test('mood priority', () => {
    expect(deriveMood({ ...base, running: false, chatBusy: true })).toBe(
        'asleep',
    )
    expect(deriveMood({ ...base, enabled: false })).toBe('asleep')
    expect(
        deriveMood({
            ...base,
            chatBusy: true,
            composing: true,
            recentFailure: true,
        }),
    ).toBe('talking')
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
    expect(faceFrame('alert', 1, false).join('')).toBe(':.[OO].:')
    expect(faceFrame('listening', 0, false).join('')).toBe('::[00]::')
    expect(faceFrame('listening', 1, false).join('')).toBe('::[00]::')
    expect(faceFrame('listening', 1, true).join('')).toBe('::[--]::')
    expect(faceFrame('talking', 0, false).join('')).toBe('.:[0o]:.')
    expect(faceFrame('talking', 1, false).join('')).toBe(':.[o0].:')
    expect(faceFrame('busy', 2, true).join('')).toBe('.:[--]:.')
})

test('tick cadence per mood', () => {
    expect(MOODS.map(tickMs)).toEqual([2400, 1400, 260, 900, 1400, 1100, 180])
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
    ])
})

test('pointer overlays: wink beats blink beats hover, and none wake a sleeper', () => {
    const rest = { blinking: false, hovered: false, winking: false }
    expect(composeFace('idle', 0, rest).join('')).toBe('.:[00]:.')
    expect(composeFace('idle', 1, { ...rest, hovered: true }).join('')).toBe(
        ':.[OO].:',
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
