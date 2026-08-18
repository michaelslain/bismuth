// app/src/connectionState.test.ts
//
// github issue #3: "connection lost — polling" could get stuck forever. Root
// cause: the poll's success path never told connectionState/the toast that
// the backend was actually reachable — only es.onopen did. See
// connectionState.ts's header comment for the full story.
//
// Round 2: fixing that made connectionState flip to "connected" on every
// successful poll, which makes a flapping SSE stream (opens, errors, opens,
// errors... — real behavior of some corporate proxies/VPNs that kill
// long-lived streams but serve ordinary GETs fine) show/dismiss the notice
// once a second forever. `TOAST_COOLDOWN_MS` fixes that; see the flapping
// test below and connectionState.ts's round-2 comment.
//
// decideConnectionState is a pure function extracted to its own module (same
// pattern as fileTreeRefresh.ts's decideTreeRefresh), so this test imports it
// directly rather than serverVersion.ts, which opens a real EventSource and
// starts a poll `setInterval` at import time.
import { describe, expect, it } from 'bun:test'
import { decideConnectionState, type ConnectionState } from './connectionState'

/** Defaults for cases that don't care about the cooldown clock: never
 *  dismissed before, "now" is arbitrary since there's nothing to cool down
 *  from. */
const noCooldown = { now: 0, dismissedAt: null }

describe('decideConnectionState', () => {
    // --- the bug (github issue #3) ------------------------------------------

    it('a poll success while disconnected returns to connected and dismisses the notice', () => {
        const d = decideConnectionState({
            state: 'disconnected',
            event: 'poll-success',
            everConnected: true,
            toastShown: true,
            ...noCooldown,
        })
        expect(d.nextState).toBe('connected')
        expect(d.dismissToast).toBe(true)
        expect(d.showToast).toBe(false)
        expect(d.pollInterval).toBe('normal')
    })

    it('a poll success while reconnecting (mid stalled SSE handshake) also recovers', () => {
        const d = decideConnectionState({
            state: 'reconnecting',
            event: 'poll-success',
            everConnected: true,
            toastShown: true,
            ...noCooldown,
        })
        expect(d.nextState).toBe('connected')
        expect(d.dismissToast).toBe(true)
    })

    // --- preserved behaviors --------------------------------------------------

    it('es.onopen still recovers from disconnected', () => {
        const d = decideConnectionState({
            state: 'disconnected',
            event: 'sse-open',
            everConnected: true,
            toastShown: true,
            ...noCooldown,
        })
        expect(d.nextState).toBe('connected')
        expect(d.dismissToast).toBe(true)
        expect(d.pollInterval).toBe('normal')
    })

    it('es.onopen still recovers from reconnecting', () => {
        const d = decideConnectionState({
            state: 'reconnecting',
            event: 'sse-open',
            everConnected: true,
            toastShown: true,
            ...noCooldown,
        })
        expect(d.nextState).toBe('connected')
        expect(d.dismissToast).toBe(true)
    })

    it('a poll failure while connected goes to disconnected and shows the notice', () => {
        const d = decideConnectionState({
            state: 'connected',
            event: 'poll-failure',
            everConnected: true,
            toastShown: false,
            ...noCooldown,
        })
        expect(d.nextState).toBe('disconnected')
        expect(d.showToast).toBe(true)
        expect(d.pollInterval).toBe('fast')
    })

    it('an sse error while connected goes to disconnected and shows the notice', () => {
        const d = decideConnectionState({
            state: 'connected',
            event: 'sse-error',
            everConnected: true,
            toastShown: false,
            ...noCooldown,
        })
        expect(d.nextState).toBe('disconnected')
        expect(d.showToast).toBe(true)
        expect(d.pollInterval).toBe('fast')
    })

    it('a repeated poll success while already connected does not re-dismiss or re-toast', () => {
        const d = decideConnectionState({
            state: 'connected',
            event: 'poll-success',
            everConnected: true,
            toastShown: false,
            ...noCooldown,
        })
        expect(d.nextState).toBe('connected')
        expect(d.dismissToast).toBe(false)
        expect(d.showToast).toBe(false)
        expect(d.pollInterval).toBe('normal')
    })

    it('a repeated sse error while already disconnected does not re-toast (dedup)', () => {
        const d = decideConnectionState({
            state: 'disconnected',
            event: 'sse-error',
            everConnected: true,
            toastShown: true,
            ...noCooldown,
        })
        expect(d.nextState).toBe('disconnected')
        expect(d.showToast).toBe(false) // already showing — no duplicate
    })

    it('suppresses the toast until the backend has ever been reached (cold-launch warmup)', () => {
        const d = decideConnectionState({
            state: 'connected',
            event: 'sse-error',
            everConnected: false,
            toastShown: false,
            ...noCooldown,
        })
        expect(d.showToast).toBe(false)
        expect(d.nextState).toBe('disconnected') // still tracks state, just no scary toast
    })

    it('poll-failure also suppresses the toast during cold-launch warmup', () => {
        const d = decideConnectionState({
            state: 'connected',
            event: 'poll-failure',
            everConnected: false,
            toastShown: false,
            ...noCooldown,
        })
        expect(d.showToast).toBe(false)
    })

    it('everConnected becomes true (sticky) on sse-open and poll-success, and is preserved on errors', () => {
        expect(
            decideConnectionState({
                state: 'disconnected',
                event: 'sse-open',
                everConnected: false,
                toastShown: false,
                ...noCooldown,
            }).everConnected,
        ).toBe(true)
        expect(
            decideConnectionState({
                state: 'disconnected',
                event: 'poll-success',
                everConnected: false,
                toastShown: false,
                ...noCooldown,
            }).everConnected,
        ).toBe(true)
        expect(
            decideConnectionState({
                state: 'connected',
                event: 'sse-error',
                everConnected: true,
                toastShown: false,
                ...noCooldown,
            }).everConnected,
        ).toBe(true)
    })

    // --- round 2: flapping SSE + a healthy poll must not spam the notice ------

    it('does not re-show the notice on every flap of a repeatedly failing SSE handshake (proxy/VPN killing long-lived streams while the poll keeps succeeding)', () => {
        // Simulates: SSE errors, ~1s later (the fast disconnected-poll interval)
        // the /version poll succeeds and recovers, SSE immediately retries and
        // errors again, repeat. A real corporate-proxy/VPN pattern, not a
        // contrived one — long-lived streams get killed but ordinary GETs go
        // through fine.
        let state: ConnectionState = 'connected'
        let toastShown = false
        let dismissedAt: number | null = null
        let now = 0
        let showCount = 0

        for (let flap = 0; flap < 5; flap++) {
            const errDecision = decideConnectionState({
                state,
                event: 'sse-error',
                everConnected: true,
                toastShown,
                now,
                dismissedAt,
            })
            state = errDecision.nextState
            dismissedAt = errDecision.dismissedAt
            if (errDecision.showToast) {
                showCount++
                toastShown = true
            }

            now += 1000 // the fast (disconnected) poll interval
            const pollDecision = decideConnectionState({
                state,
                event: 'poll-success',
                everConnected: true,
                toastShown,
                now,
                dismissedAt,
            })
            state = pollDecision.nextState
            dismissedAt = pollDecision.dismissedAt
            if (pollDecision.dismissToast) toastShown = false
        }

        // Must not spam: at most one show across the whole flapping run, not one
        // per flap (this must be false before the fix — 5 shows for 5 flaps).
        expect(showCount).toBeLessThanOrEqual(1)
    })

    it("the notice CAN show again once the cooldown has clearly elapsed (a genuinely still-down connection isn't silenced forever)", () => {
        const first = decideConnectionState({
            state: 'connected',
            event: 'sse-error',
            everConnected: true,
            toastShown: false,
            now: 0,
            dismissedAt: null,
        })
        expect(first.showToast).toBe(true)

        // Recovers and dismisses...
        const recovered = decideConnectionState({
            state: first.nextState,
            event: 'poll-success',
            everConnected: true,
            toastShown: true,
            now: 100,
            dismissedAt: first.dismissedAt,
        })
        expect(recovered.dismissToast).toBe(true)

        // ...then drops again a long time later (a generous margin well past any
        // reasonable cooldown, so this doesn't hinge on the exact constant chosen).
        const later = decideConnectionState({
            state: recovered.nextState,
            event: 'sse-error',
            everConnected: true,
            toastShown: false,
            now: 100 + 60_000,
            dismissedAt: recovered.dismissedAt,
        })
        expect(later.showToast).toBe(true)
    })

    // --- regression: poll-failure must stay reachable once already disconnected ---

    it('shows the notice again for a sustained outage that begins shortly after a dismissal, even once state has already left "connected"', () => {
        // serverVersion.ts's poll catch handler (~line 191) used to call
        // applyConnectionDecision("poll-failure") only while `connectionState() ===
        // "connected"`. That guard meant a poll-failure arriving at any point AFTER
        // state had already left "connected" was silently dropped, so
        // decideConnectionState was never re-evaluated again for the rest of the
        // outage. Once the toast was dismissed (e.g. by a brief recovery) and the
        // post-dismissal cooldown passed, a still-dead backend's toast + Retry-now
        // button never came back — even across minutes of continuous failure
        // (regression found in whole-branch review). The fix calls
        // applyConnectionDecision unconditionally on every poll-failure — this
        // test models that unconditional call site. Confirmed during TDD: adding
        // back `if (event === "poll-failure" && state !== "connected") return;`
        // here reproduces the bug and makes this test fail.
        //
        // serverVersion.ts itself can't be imported headless (it opens a real
        // EventSource + starts a poll setInterval at module load), so this drives
        // decideConnectionState directly through the same event sequence its call
        // sites produce.
        //
        // Timeline: SSE dies at t=0 (toast shows) -> poll recovers at t=1000
        // (toast dismissed, dismissedAt=1000) -> SSE flaps at t=1100, within the
        // 5s cooldown (correctly suppressed, per the flapping test above) -> the
        // backend then goes down for real; poll failures continue every 1s
        // (DISCONNECTED_POLL_INTERVAL) for two full minutes. The notice MUST
        // reappear once the cooldown has elapsed — that is the fix under test.
        let state: ConnectionState = 'connected'
        let toastShown = false
        let dismissedAt: number | null = null
        let shownAgain = false

        const step = (
            event: 'sse-error' | 'poll-failure' | 'poll-success',
            now: number,
        ) => {
            const d = decideConnectionState({
                state,
                event,
                everConnected: true,
                toastShown,
                now,
                dismissedAt,
            })
            state = d.nextState
            dismissedAt = d.dismissedAt
            if (d.showToast) {
                toastShown = true
                shownAgain = true
            }
            if (d.dismissToast) toastShown = false
        }

        step('sse-error', 0)
        step('poll-success', 1000)
        step('sse-error', 1100)

        shownAgain = false // only the sustained-outage period below is under test
        for (let t = 1100; t <= 1100 + 120_000; t += 1000) {
            step('poll-failure', t)
        }

        expect(shownAgain).toBe(true)
    })
})
