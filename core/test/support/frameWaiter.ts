// core/test/support/frameWaiter.ts
// The frame transcript + "await a frame matching a predicate" logic shared by the chat tests: an
// in-process sink collector (chat.test.ts) and a websocket client (server.chat-ws.test.ts) both
// record every frame in arrival order and let a test wait for the first one that matches.

/** Anything with an optional `type` tag — a ChatFrame or a raw parsed socket frame. */
export type TypedFrame = { type?: string }

export type FrameWaiter<F extends TypedFrame> = {
    /** Every frame pushed so far, in arrival order. */
    frames: F[]
    /** Record a frame and resolve every waiter whose predicate it satisfies. */
    push(frame: F): void
    /** Resolve with the first frame (already seen, or yet to arrive) matching `pred`; reject after
     *  `timeoutMs` with `what` and the frame types seen. */
    waitFor(
        pred: (f: F) => boolean,
        what?: string,
        timeoutMs?: number,
    ): Promise<F>
}

export function createFrameWaiter<F extends TypedFrame>(
    defaultTimeoutMs = 15_000,
): FrameWaiter<F> {
    const frames: F[] = []
    const waiters: { pred: (f: F) => boolean; resolve: (f: F) => void }[] = []

    return {
        frames,
        push(frame) {
            frames.push(frame)
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i]!.pred(frame)) {
                    waiters[i]!.resolve(frame)
                    waiters.splice(i, 1)
                }
            }
        },
        waitFor(pred, what = 'frame', timeoutMs = defaultTimeoutMs) {
            const hit = frames.find(pred)
            if (hit) return Promise.resolve(hit)
            return new Promise<F>((resolve, reject) => {
                const waiter = {
                    pred,
                    resolve: (f: F) => {
                        clearTimeout(timer)
                        resolve(f)
                    },
                }
                const timer = setTimeout(() => {
                    const idx = waiters.indexOf(waiter)
                    if (idx >= 0) waiters.splice(idx, 1)
                    reject(
                        new Error(
                            `timeout waiting for ${what}; frames seen: ${JSON.stringify(frames.map(f => f.type))}`,
                        ),
                    )
                }, timeoutMs)
                waiters.push(waiter)
            })
        },
    }
}
