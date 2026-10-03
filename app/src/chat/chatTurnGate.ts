// Pure bookkeeping for the stop/done race. Stop flips the UI to idle at once, but the server still
// emits `done` for the interrupted turn; if the user sends again first, that stale `done` must not
// mark the NEW turn finished. `stale` counts stopped turns whose `done` has not arrived yet.

/** Stop pressed: a running turn will still emit one `done` that belongs to no live turn. */
export function gateStop(stale: number, wasStreaming: boolean): number {
    return wasStreaming ? stale + 1 : stale
}

/** A `done` frame arrived: it is the stopped turn's (swallowed) while any are outstanding. */
export function gateDone(stale: number): { stale: number; finished: boolean } {
    return stale > 0
        ? { stale: stale - 1, finished: false }
        : { stale: 0, finished: true }
}
