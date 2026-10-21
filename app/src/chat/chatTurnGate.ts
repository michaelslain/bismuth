// Pure bookkeeping for when a turn is over.
//
// A backend that holds messages until the turn ends (opencode, codex, ACP): Stop flips the UI to
// idle at once, but the server still emits `done` for the interrupted turn; if the user sends again
// first, that stale `done` must not mark the NEW turn finished. `stale` counts stopped turns whose
// `done` has not arrived yet.
//
// A backend that reads messages mid-turn (Claude Code): every sent message carries an id the server
// echoes in a `delivered` frame once the backend takes it up. A `done` while any sent id is still
// undelivered belongs to an earlier turn, since a turn for that message is still to come.

/** Stop pressed: a running turn will still emit one `done` that belongs to no live turn. */
export function gateStop(stale: number, wasStreaming: boolean): number {
    return wasStreaming ? stale + 1 : stale
}

/** A `done` frame arrived: it is the stopped turn's (swallowed) while any are outstanding. An `idle`
 *  done (a reconnect found no turn running) finishes regardless: nothing else is coming. */
export function gateDone(
    stale: number,
    idle = false,
): { stale: number; finished: boolean } {
    if (idle) return { stale: 0, finished: true }
    return stale > 0
        ? { stale: stale - 1, finished: false }
        : { stale: 0, finished: true }
}

/** An `error` frame ended the turn with no `done`: nothing stale can still arrive. */
export function gateError(): number {
    return 0
}

/** A `delivered` frame: those ids were taken up by the backend. */
export function settleDelivered(
    pending: readonly string[],
    ids: readonly string[],
): string[] {
    return pending.filter(id => !ids.includes(id))
}

/** A `done` on a mid-turn backend finishes the turn only when no sent message is still waiting.
 *  An `idle` done finishes regardless, and drops the waiting ids: the backend never received them. */
export function deliveryDone(
    pending: readonly string[],
    idle = false,
): { pending: string[]; finished: boolean } {
    if (idle) return { pending: [], finished: true }
    return { pending: [...pending], finished: pending.length === 0 }
}
