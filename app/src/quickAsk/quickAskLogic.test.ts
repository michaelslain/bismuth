import { describe, expect, test } from 'bun:test'
import type { TurnItem } from '../chat/chatTranscriptLogic'
import {
    CONVERSATION_ITEMS,
    INLINE_PROMPT_ITEMS,
    MULTI_TURN_ITEMS,
} from '../chat/_transcriptFixtures'
import {
    applyMessage,
    faceMood,
    isApplyMessage,
    popoverPlacement,
    popoverWidth,
    quickAskTurns,
    sendWhenOpen,
} from './quickAskLogic'

describe('applyMessage', () => {
    test('names the note and asks for a direct edit', () => {
        const m = applyMessage('notes/fox.md')
        expect(m).toContain('notes/fox.md')
        expect(m).toContain('edit the file directly')
    })

    test('isApplyMessage recognises exactly its own output', () => {
        expect(isApplyMessage(applyMessage('a/b.md'))).toBe(true)
        expect(isApplyMessage('apply')).toBe(false)
        expect(isApplyMessage('please apply the change you suggested to x')).toBe(false)
    })
})

describe('quickAskTurns', () => {
    test('empty transcript gives no turns', () => {
        expect(quickAskTurns([])).toEqual([])
    })

    test('users keep their text, assistants concatenate text parts, system is dropped', () => {
        const t: TurnItem[] = [
            { role: 'user', text: 'shorter?' },
            { role: 'system', text: 'noted' },
            {
                role: 'assistant',
                footer: null,
                parts: [
                    { kind: 'text', text: 'one ' },
                    { kind: 'thinking', text: 'hmm' },
                    { kind: 'text', text: 'two' },
                ],
            },
        ]
        expect(quickAskTurns(t)).toEqual([
            { role: 'user', text: 'shorter?' },
            { role: 'assistant', text: 'one two' },
        ])
    })

    test('an apply message reads as `apply`', () => {
        const t: TurnItem[] = [{ role: 'user', text: applyMessage('notes/fox.md') }]
        expect(quickAskTurns(t)).toEqual([{ role: 'user', text: 'apply' }])
    })

    test('multi-turn fixtures keep order and ignore non-text parts', () => {
        const turns = quickAskTurns(MULTI_TURN_ITEMS)
        expect(turns.length).toBeGreaterThan(1)
        expect(turns.some(x => x.text.includes('undefined'))).toBe(false)
        expect(quickAskTurns(INLINE_PROMPT_ITEMS).some(x => x.text.includes('undefined'))).toBe(
            false,
        )
        expect(quickAskTurns(CONVERSATION_ITEMS)[0].role).toBe('user')
    })
})

describe('faceMood', () => {
    const on = {
        daemonEnabled: true,
        streaming: false,
        hasReplyText: false,
        typing: false,
    }
    test('asleep whenever the daemon is off', () => {
        expect(
            faceMood({
                ...on,
                daemonEnabled: false,
                streaming: true,
                typing: true,
            }),
        ).toBe('asleep')
    })
    test('thinking until reply text, then talking', () => {
        expect(faceMood({ ...on, streaming: true })).toBe('thinking')
        expect(faceMood({ ...on, streaming: true, hasReplyText: true })).toBe('talking')
    })
    test('listening while typing, idle otherwise', () => {
        expect(faceMood({ ...on, typing: true })).toBe('listening')
        expect(faceMood(on)).toBe('idle')
    })
})

describe('popoverWidth', () => {
    test('min(480, pane - 32)', () => {
        expect(popoverWidth(1000)).toBe(480)
        expect(popoverWidth(400)).toBe(368)
    })
})

const pane = { left: 100, top: 50, width: 800, height: 600 }
const size = { width: 480, height: 40 }

describe('popoverPlacement', () => {
    test('below the caret line when there is room, 6px gap', () => {
        const r = popoverPlacement({
            caret: { left: 300, top: 300, bottom: 320 },
            pane,
            size,
        })
        expect(r).toEqual({ left: 300, top: 326, side: 'below' })
    })

    test('above the caret line when there is no room below', () => {
        const r = popoverPlacement({
            caret: { left: 300, top: 610, bottom: 630 },
            pane,
            size,
        })
        expect(r).toEqual({ left: 300, top: 610 - 6 - 40, side: 'above' })
    })

    test('a latched side survives growth', () => {
        const grown = { width: 480, height: 300 }
        const below = popoverPlacement({
            caret: { left: 300, top: 300, bottom: 320 },
            pane,
            size: grown,
            latched: 'below',
        })
        expect(below).toEqual({ left: 300, top: 326, side: 'below' })
        const above = popoverPlacement({
            caret: { left: 300, top: 610, bottom: 630 },
            pane,
            size: grown,
            latched: 'above',
        })
        expect(above).toEqual({ left: 300, top: 610 - 6 - 300, side: 'above' })
    })

    test('pane-top with no caret: centred, 48px from the top', () => {
        const r = popoverPlacement({ caret: null, pane, size })
        expect(r).toEqual({
            left: 100 + (800 - 480) / 2,
            top: 98,
            side: 'pane-top',
        })
    })

    test('clamped inside the pane with a 16px inset', () => {
        const right = popoverPlacement({
            caret: { left: 880, top: 300, bottom: 320 },
            pane,
            size,
        })
        expect(right.left).toBe(100 + 800 - 16 - 480)
        const left = popoverPlacement({
            caret: { left: 10, top: 300, bottom: 320 },
            pane,
            size,
        })
        expect(left.left).toBe(116)
        const bottom = popoverPlacement({
            caret: { left: 300, top: 60, bottom: 640 },
            pane,
            size,
        })
        expect(bottom.side).toBe('below')
        expect(bottom.top).toBe(50 + 600 - 16 - 40)
    })
})

describe('sendWhenOpen', () => {
    function fake(refuse: number) {
        let draft = ''
        let sends = 0
        let accepted = 0
        let blocked = false
        const queue: (() => void)[] = []
        return {
            target: {
                setDraft: (v: string) => {
                    draft = v
                },
                send: () => {
                    sends++
                    if (sends > refuse) {
                        accepted++
                        draft = ''
                    }
                },
                draft: () => draft,
                blocked: () => blocked,
            },
            queue,
            schedule: (fn: () => void) => queue.push(fn),
            stats: () => ({ sends, accepted }),
            block: () => {
                blocked = true
            },
        }
    }
    const drain = (queue: (() => void)[]) => {
        while (queue.length) queue.shift()!()
    }

    test('retries past any count until accepted, exactly one accepted send', () => {
        const f = fake(200)
        sendWhenOpen(f.target, 'hi', () => true, f.schedule)
        drain(f.queue)
        expect(f.stats()).toEqual({ sends: 201, accepted: 1 })
    })

    test('no call after isLive turns false', () => {
        const f = fake(100)
        let live = true
        sendWhenOpen(f.target, 'hi', () => live, f.schedule)
        f.queue.shift()!()
        live = false
        drain(f.queue)
        expect(f.stats().sends).toBe(2)
        expect(f.stats().accepted).toBe(0)
    })

    test('no retry once blocked', () => {
        const f = fake(100)
        const send = f.target.send
        f.target.send = () => {
            send()
            f.block()
        }
        sendWhenOpen(f.target, 'hi', () => true, f.schedule)
        drain(f.queue)
        expect(f.stats().sends).toBe(1)
    })
})
