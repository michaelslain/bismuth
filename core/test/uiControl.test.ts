import { test, expect, beforeEach } from 'bun:test'
import {
    registerWindow,
    unregisterWindow,
    updateTabs,
    listWindows,
    resolveTarget,
    sendCommand,
    resolveReply,
    windowCount,
    resetUiControl,
    type UiTabsSnapshot,
} from '../src/uiControl'

beforeEach(() => resetUiControl())

const snap = (activeTabId: string, label: string): UiTabsSnapshot => ({
    activeTabId,
    tabs: [
        {
            tabId: activeTabId,
            label,
            active: true,
            leaves: [{ leafId: 'l1', content: 'a.md', label, active: true }],
        },
    ],
})

test('register + heartbeat surfaces the window in listWindows with a distinct label', () => {
    registerWindow('w1', () => {})
    updateTabs('w1', snap('t1', 'Note A'))
    const list = listWindows()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'w1', activeTabId: 't1', tabCount: 1 })
    expect(list[0].label).toContain('Note A')
})

test('resolveTarget: none → 404, single → the one, ambiguous → 409, explicit-unknown → 404', () => {
    expect(resolveTarget()).toMatchObject({ ok: false, status: 404 })
    registerWindow('only', () => {})
    expect(resolveTarget()).toEqual({ ok: true, id: 'only' })
    expect(resolveTarget('nope')).toMatchObject({ ok: false, status: 404 })
    registerWindow('second', () => {})
    expect(resolveTarget()).toMatchObject({ ok: false, status: 409 })
    expect(resolveTarget('second')).toEqual({ ok: true, id: 'second' })
})

test('sendCommand pushes a command frame + round-trips its reply', async () => {
    const frames: any[] = []
    registerWindow('w1', f => frames.push(f))
    const p = sendCommand('w1', 'list-tabs', {}, 1000)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'command', action: 'list-tabs' })
    const reqId = frames[0].reqId
    resolveReply(reqId, { ok: true, result: { tabs: [], activeTabId: null } })
    expect(await p).toEqual({
        ok: true,
        result: { tabs: [], activeTabId: null },
    })
})

test('sendCommand times out to ok:false (no reply)', async () => {
    registerWindow('w1', () => {})
    const reply = await sendCommand('w1', 'x', {}, 10)
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('did not respond')
})

test('sendCommand to a vanished window resolves ok:false without hanging', async () => {
    const reply = await sendCommand('ghost', 'x', {}, 10)
    expect(reply.ok).toBe(false)
})

test("unregister is identity-guarded — a stale close doesn't drop a reconnected socket", () => {
    const s1 = () => {}
    const s2 = () => {}
    registerWindow('w1', s1)
    registerWindow('w1', s2) // reconnect swaps in a new socket under the same id
    unregisterWindow('w1', s1) // the OLD socket's close arrives late
    expect(windowCount()).toBe(1)
    unregisterWindow('w1', s2)
    expect(windowCount()).toBe(0)
})

test('a reply for an unknown/stale reqId is ignored (no throw)', () => {
    expect(() => resolveReply('nope', { ok: true })).not.toThrow()
})

// --- rename-tab / pin-tab / reorder-tab -----------------------------------------------------
// The registry (sendCommand/resolveReply) is action-agnostic — it doesn't know what "rename-tab"
// means, it just relays {action, args} and round-trips whatever reply the window sends back. So
// these tests prove the channel carries the new actions' frames + replies correctly, exercising
// the same generic harness as `list-tabs` above (a real window would validate tabId/name/pinned/
// index and answer accordingly; that validation lives client-side in uiControlClient.ts + App.tsx,
// not in this pure registry).

test('rename-tab: happy path + invalid tabId round-trip through the registry', async () => {
    const frames: any[] = []
    registerWindow('w1', f => frames.push(f))
    const ok = sendCommand(
        'w1',
        'rename-tab',
        { tabId: 't1', name: 'Renamed' },
        1000,
    )
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
        type: 'command',
        action: 'rename-tab',
        args: { tabId: 't1', name: 'Renamed' },
    })
    resolveReply(frames[0].reqId, { ok: true })
    expect(await ok).toEqual({ ok: true })

    const bad = sendCommand(
        'w1',
        'rename-tab',
        { tabId: 'bogus', name: 'X' },
        1000,
    )
    expect(frames).toHaveLength(2)
    resolveReply(frames[1].reqId, { ok: false, error: 'no tab "bogus"' })
    const reply = await bad
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('bogus')
})

test('pin-tab: happy path + invalid tabId round-trip through the registry', async () => {
    const frames: any[] = []
    registerWindow('w1', f => frames.push(f))
    const ok = sendCommand('w1', 'pin-tab', { tabId: 't1', pinned: true }, 1000)
    expect(frames[0]).toMatchObject({
        type: 'command',
        action: 'pin-tab',
        args: { tabId: 't1', pinned: true },
    })
    resolveReply(frames[0].reqId, { ok: true })
    expect(await ok).toEqual({ ok: true })

    const bad = sendCommand(
        'w1',
        'pin-tab',
        { tabId: 'bogus', pinned: false },
        1000,
    )
    resolveReply(frames[1].reqId, { ok: false, error: 'no tab "bogus"' })
    const reply = await bad
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('bogus')
})

test('reorder-tab: happy path + invalid tabId round-trip through the registry', async () => {
    const frames: any[] = []
    registerWindow('w1', f => frames.push(f))
    const ok = sendCommand('w1', 'reorder-tab', { tabId: 't1', index: 2 }, 1000)
    expect(frames[0]).toMatchObject({
        type: 'command',
        action: 'reorder-tab',
        args: { tabId: 't1', index: 2 },
    })
    resolveReply(frames[0].reqId, { ok: true })
    expect(await ok).toEqual({ ok: true })

    const bad = sendCommand(
        'w1',
        'reorder-tab',
        { tabId: 'bogus', index: 0 },
        1000,
    )
    resolveReply(frames[1].reqId, { ok: false, error: 'no tab "bogus"' })
    const reply = await bad
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('bogus')
})
