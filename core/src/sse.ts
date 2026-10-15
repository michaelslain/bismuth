type SseController = ReadableStreamDefaultController<Uint8Array>

/** Encode a JSON payload as an SSE `data:` frame (single event, no id/event-type). */
export function formatEvent(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`
}

/** Tracks connected SSE clients and broadcasts events to all of them. */
export function createSseRegistry() {
    const clients = new Set<SseController>()
    // Callers parked in whenSubscribed(); all of them wake on the next subscribe.
    const waiters = new Set<() => void>()
    const encoder = new TextEncoder()

    function broadcast(frame: Uint8Array): void {
        for (const ctrl of clients) {
            try {
                ctrl.enqueue(frame)
            } catch {
                // Controller is closed; drop it so we don't keep failing on each publish.
                clients.delete(ctrl)
            }
        }
    }

    return {
        subscribe(ctrl: SseController): void {
            clients.add(ctrl)
            for (const wake of waiters) wake()
            waiters.clear()
        },
        /** Resolves at once when a client is connected, otherwise on the next subscribe. Work that
         *  only matters to a connected client (view warm-up) parks here instead of running unseen. */
        whenSubscribed(): Promise<void> {
            if (clients.size > 0) return Promise.resolve()
            return new Promise<void>(resolve => waiters.add(resolve))
        },
        unsubscribe(ctrl: SseController): void {
            clients.delete(ctrl)
        },
        publish(payload: unknown): void {
            const frame = encoder.encode(formatEvent(payload))
            broadcast(frame)
        },
        /** Test-only inspection of the current subscriber count. */
        size(): number {
            return clients.size
        },
    }
}
