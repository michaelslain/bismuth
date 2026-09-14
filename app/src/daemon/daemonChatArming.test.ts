import { describe, expect, test } from 'bun:test'
import { isArmingGesture, stayArmed } from './daemonChatArming'

describe('isArmingGesture', () => {
    test('a trusted pointerdown or focusin arms', () => {
        expect(isArmingGesture({ type: 'pointerdown', isTrusted: true })).toBe(
            true,
        )
        expect(isArmingGesture({ type: 'focusin', isTrusted: true })).toBe(true)
    })

    test('a synthetic event never arms, whatever its type', () => {
        expect(isArmingGesture({ type: 'pointerdown', isTrusted: false })).toBe(
            false,
        )
        expect(isArmingGesture({ type: 'focusin', isTrusted: false })).toBe(
            false,
        )
    })

    test('other trusted events do not arm', () => {
        for (const type of [
            'pointermove',
            'click',
            'keydown',
            'mouseover',
            'focus',
        ])
            expect(isArmingGesture({ type, isTrusted: true })).toBe(false)
    })

    test('a truthy non-boolean isTrusted does not arm', () => {
        const forged = {
            type: 'pointerdown',
            isTrusted: 1 as unknown as boolean,
        }
        expect(isArmingGesture(forged)).toBe(false)
    })
})

describe('stayArmed', () => {
    const open = { daemonOpen: true, enabled: true }

    test('never arms on its own', () => {
        expect(stayArmed(false, open)).toBe(false)
    })

    test('an armed chat stays armed while a daemon leaf is open and the daemon is on', () => {
        expect(stayArmed(true, open)).toBe(true)
    })

    test('closing the last daemon leaf disarms', () => {
        expect(stayArmed(true, { ...open, daemonOpen: false })).toBe(false)
    })

    test('turning the daemon off disarms', () => {
        expect(stayArmed(true, { ...open, enabled: false })).toBe(false)
    })
})
