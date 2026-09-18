// app/src/chatComposerKeys.test.ts
import { describe, it, expect } from 'bun:test'
import {
    classifyComposerKey,
    DEFAULT_COMPOSER_KEY_COMBOS,
} from './chatComposerKeys'

const idle = { slashOpen: false, streaming: false }

describe('classifyComposerKey', () => {
    it('Enter (no Shift) sends when idle', () => {
        expect(
            classifyComposerKey({ key: 'Enter', shiftKey: false }, idle),
        ).toBe('send')
    })

    it('Shift+Enter passes through to CodeMirror (a plain newline)', () => {
        expect(
            classifyComposerKey({ key: 'Enter', shiftKey: true }, idle),
        ).toBe('pass')
    })

    it('Enter still sends while a turn is streaming (mid-turn staging)', () => {
        expect(
            classifyComposerKey(
                { key: 'Enter', shiftKey: false },
                { slashOpen: false, streaming: true },
            ),
        ).toBe('send')
    })

    it('Escape interrupts while streaming', () => {
        expect(
            classifyComposerKey(
                { key: 'Escape', shiftKey: false },
                { slashOpen: false, streaming: true },
            ),
        ).toBe('stop')
    })

    it('Escape does nothing (passes) when not streaming and no popover', () => {
        expect(
            classifyComposerKey({ key: 'Escape', shiftKey: false }, idle),
        ).toBe('pass')
    })

    it('ordinary typing passes through', () => {
        expect(classifyComposerKey({ key: 'a', shiftKey: false }, idle)).toBe(
            'pass',
        )
        expect(
            classifyComposerKey({ key: 'ArrowDown', shiftKey: false }, idle),
        ).toBe('pass')
    })

    describe('prompt history (arrow keys at a boundary)', () => {
        it('ArrowUp at the top boundary recalls history', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowUp', shiftKey: false },
                    { ...idle, atTop: true },
                ),
            ).toBe('history-up')
        })
        it('ArrowUp NOT at the top boundary passes through (ordinary multi-line movement)', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowUp', shiftKey: false },
                    { ...idle, atTop: false },
                ),
            ).toBe('pass')
        })
        it('ArrowDown at the bottom boundary moves toward the newest / draft', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowDown', shiftKey: false },
                    { ...idle, atBottom: true },
                ),
            ).toBe('history-down')
        })
        it('ArrowDown NOT at the bottom boundary passes through', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowDown', shiftKey: false },
                    { ...idle, atBottom: false },
                ),
            ).toBe('pass')
        })
        it('the slash popover still wins over history recall when open', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowUp', shiftKey: false },
                    { slashOpen: true, streaming: false, atTop: true },
                ),
            ).toBe('slash-nav')
            expect(
                classifyComposerKey(
                    { key: 'ArrowDown', shiftKey: false },
                    { slashOpen: true, streaming: false, atBottom: true },
                ),
            ).toBe('slash-nav')
        })
    })

    describe('slash popover open', () => {
        const slash = { slashOpen: true, streaming: false }
        it('Arrow keys navigate the menu', () => {
            expect(
                classifyComposerKey(
                    { key: 'ArrowDown', shiftKey: false },
                    slash,
                ),
            ).toBe('slash-nav')
            expect(
                classifyComposerKey({ key: 'ArrowUp', shiftKey: false }, slash),
            ).toBe('slash-nav')
        })
        it('Escape closes the menu (nav), not a stop', () => {
            expect(
                classifyComposerKey({ key: 'Escape', shiftKey: false }, slash),
            ).toBe('slash-nav')
        })
        it('Escape closes the menu even while streaming (popover wins over stop)', () => {
            expect(
                classifyComposerKey(
                    { key: 'Escape', shiftKey: false },
                    { slashOpen: true, streaming: true },
                ),
            ).toBe('slash-nav')
        })
        it('Enter picks the highlighted command', () => {
            expect(
                classifyComposerKey({ key: 'Enter', shiftKey: false }, slash),
            ).toBe('slash-select')
        })
        it('Shift+Enter still passes (newline) even with the popover open', () => {
            expect(
                classifyComposerKey({ key: 'Enter', shiftKey: true }, slash),
            ).toBe('pass')
        })
        it('ordinary typing passes so the query keeps updating', () => {
            expect(
                classifyComposerKey({ key: 'x', shiftKey: false }, slash),
            ).toBe('pass')
        })
    })

    // Every test above omits the third argument entirely, so it's already proof that
    // DEFAULT_COMPOSER_KEY_COMBOS reproduces the old hardcoded table byte-for-byte. These cover the
    // case that table couldn't express at all: an ACTUAL rebind changing which key does what — the
    // thing this whole task exists to make possible. A weak version of this suite would only check
    // that the NEW combo works; the point is proving the OLD one stops.
    describe('settings-driven combos (rebinding)', () => {
        it('rebinding chat-send to Mod+Enter: plain Enter no longer sends — it passes through as a newline', () => {
            const combos = {
                ...DEFAULT_COMPOSER_KEY_COMBOS,
                'chat-send': 'Mod+Enter',
            }
            expect(
                classifyComposerKey(
                    { key: 'Enter', code: 'Enter', shiftKey: false },
                    idle,
                    combos,
                ),
            ).toBe('pass')
        })

        it('rebinding chat-send to Mod+Enter: Mod+Enter (Cmd OR Ctrl) sends', () => {
            const combos = {
                ...DEFAULT_COMPOSER_KEY_COMBOS,
                'chat-send': 'Mod+Enter',
            }
            expect(
                classifyComposerKey(
                    {
                        key: 'Enter',
                        code: 'Enter',
                        shiftKey: false,
                        metaKey: true,
                    },
                    idle,
                    combos,
                ),
            ).toBe('send')
            expect(
                classifyComposerKey(
                    {
                        key: 'Enter',
                        code: 'Enter',
                        shiftKey: false,
                        ctrlKey: true,
                    },
                    idle,
                    combos,
                ),
            ).toBe('send')
        })

        it('rebinding chat-stop: the OLD Escape no longer stops, the new combo does', () => {
            const combos = {
                ...DEFAULT_COMPOSER_KEY_COMBOS,
                'chat-stop': 'Mod+.',
            }
            const streaming = { slashOpen: false, streaming: true }
            expect(
                classifyComposerKey(
                    { key: 'Escape', shiftKey: false },
                    streaming,
                    combos,
                ),
            ).toBe('pass')
            expect(
                classifyComposerKey(
                    {
                        key: '.',
                        code: 'Period',
                        shiftKey: false,
                        metaKey: true,
                    },
                    streaming,
                    combos,
                ),
            ).toBe('stop')
        })

        it('rebinding chat-history-prev: the OLD plain ArrowUp no longer recalls, the new combo does', () => {
            const combos = {
                ...DEFAULT_COMPOSER_KEY_COMBOS,
                'chat-history-prev': 'Mod+ArrowUp',
            }
            const top = { slashOpen: false, streaming: false, atTop: true }
            expect(
                classifyComposerKey(
                    { key: 'ArrowUp', shiftKey: false },
                    top,
                    combos,
                ),
            ).toBe('pass')
            expect(
                classifyComposerKey(
                    { key: 'ArrowUp', shiftKey: false, metaKey: true },
                    top,
                    combos,
                ),
            ).toBe('history-up')
        })

        it('the slash popover still wins over a rebound chat-send while open', () => {
            const combos = {
                ...DEFAULT_COMPOSER_KEY_COMBOS,
                'chat-send': 'Mod+Enter',
            }
            expect(
                classifyComposerKey(
                    { key: 'Enter', shiftKey: false },
                    { slashOpen: true, streaming: false },
                    combos,
                ),
            ).toBe('slash-select')
        })

        it('an unbound (empty) chat-send never sends', () => {
            const combos = { ...DEFAULT_COMPOSER_KEY_COMBOS, 'chat-send': '' }
            expect(
                classifyComposerKey(
                    { key: 'Enter', shiftKey: false },
                    idle,
                    combos,
                ),
            ).toBe('pass')
        })
    })
})
