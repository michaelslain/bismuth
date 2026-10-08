import { describe, expect, test } from 'bun:test'
import {
    applyMessage,
    faceMood,
    forgetQuickChatEntry,
    isClick,
    popoverPlacement,
    popoverWidth,
    quickChatFor,
    rememberQuickChat,
    sendWhenOpen,
} from './quickAskLogic'

describe('applyMessage', () => {
    test('names the note and asks for a direct edit', () => {
        const m = applyMessage('notes/fox.md')
        expect(m).toContain('notes/fox.md')
        expect(m).toContain('edit the file directly')
    })
})

describe('remembered quick chats', () => {
    test('a key finds its chat; an unknown key finds none', () => {
        const { list } = rememberQuickChat([], 'a.md', 'quick-1')
        expect(quickChatFor(list, 'a.md')).toBe('quick-1')
        expect(quickChatFor(list, 'b.md')).toBeNull()
    })

    test('one entry per key, most recent last', () => {
        let list = rememberQuickChat([], 'a.md', 'quick-1').list
        list = rememberQuickChat(list, 'b.md', 'quick-2').list
        list = rememberQuickChat(list, 'a.md', 'quick-1').list
        expect(list).toEqual([
            { chatId: 'quick-2', key: 'b.md' },
            { chatId: 'quick-1', key: 'a.md' },
        ])
    })

    test('a key given a new chat evicts its old one', () => {
        const first = rememberQuickChat([], 'a.md', 'quick-1').list
        const r = rememberQuickChat(first, 'a.md', 'quick-9')
        expect(r.list).toEqual([{ chatId: 'quick-9', key: 'a.md' }])
        expect(r.evicted).toEqual(['quick-1'])
    })

    test('past the cap the oldest falls off and is reported', () => {
        let list = rememberQuickChat([], 'a.md', 'quick-1', 2).list
        list = rememberQuickChat(list, 'b.md', 'quick-2', 2).list
        const r = rememberQuickChat(list, 'c.md', 'quick-3', 2)
        expect(r.list.map(e => e.key)).toEqual(['b.md', 'c.md'])
        expect(r.evicted).toEqual(['quick-1'])
    })

    test('forgetting drops the entry by chat id', () => {
        const { list } = rememberQuickChat([], 'a.md', 'quick-1')
        expect(forgetQuickChatEntry(list, 'quick-1')).toEqual([])
    })
})

describe('isClick', () => {
    test('a press that stays within 4px is a click; past it, a drag', () => {
        expect(isClick({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true)
        expect(isClick({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(false)
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
        expect(faceMood({ ...on, streaming: true, hasReplyText: true })).toBe(
            'talking',
        )
    })
    test('listening while typing, idle otherwise', () => {
        expect(faceMood({ ...on, typing: true })).toBe('listening')
        expect(faceMood(on)).toBe('idle')
    })
})

describe('popoverWidth', () => {
    test('min(560, pane - 32)', () => {
        expect(popoverWidth(1000)).toBe(560)
        expect(popoverWidth(400)).toBe(368)
    })
})

const pane = { left: 100, top: 50, width: 800, height: 600 }
const size = { width: 480, height: 40 }

describe('popoverPlacement', () => {
    test('below the caret line when there is room, 6px gap, as tall as the room allows', () => {
        const r = popoverPlacement({
            caret: { left: 300, top: 300, bottom: 320 },
            pane,
            size,
        })
        // room below: (50 + 600 - 16) - 326 = 308; above: 300 - 6 - 66 = 228
        expect(r).toEqual({
            left: 300,
            top: 326,
            side: 'below',
            maxHeight: 308,
        })
    })

    test('above the caret line when there is less room below than above', () => {
        const r = popoverPlacement({
            caret: { left: 300, top: 500, bottom: 520 },
            pane,
            size,
        })
        expect(r).toEqual({
            left: 300,
            top: 500 - 6 - 40,
            side: 'above',
            maxHeight: 428,
        })
    })

    test('the side depends on the room, never on the size, so growth never flips it', () => {
        const caret = { left: 300, top: 300, bottom: 320 }
        const small = popoverPlacement({ caret, pane, size })
        const grown = popoverPlacement({
            caret,
            pane,
            size: { width: 480, height: 300 },
        })
        expect(grown.side).toBe(small.side)
        expect(grown.top).toBe(326)
    })

    test('maxHeight is capped at 560', () => {
        const tall = { left: 0, top: 0, width: 800, height: 2000 }
        const r = popoverPlacement({
            caret: { left: 100, top: 10, bottom: 30 },
            pane: tall,
            size,
        })
        expect(r.maxHeight).toBe(560)
    })

    test('pane-top with no caret: centred, 48px from the top', () => {
        const r = popoverPlacement({ caret: null, pane, size })
        expect(r).toEqual({
            left: 100 + (800 - 480) / 2,
            top: 98,
            side: 'pane-top',
            maxHeight: 50 + 600 - 16 - 98,
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
