type SseController = ReadableStreamDefaultController<Uint8Array>;

/** Encode a JSON payload as an SSE `data:` frame (single event, no id/event-type). */
export function formatEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Tracks connected SSE clients and broadcasts events to all of them. */
export function createSseRegistry() {
  const clients = new Set<SseController>();
  const encoder = new TextEncoder();

  function broadcast(frame: Uint8Array): void {
    for (const ctrl of clients) {
      try {
        ctrl.enqueue(frame);
      } catch {
        // Controller is closed; drop it so we don't keep failing on each publish.
        clients.delete(ctrl);
      }
    }
  }

  return {
    subscribe(ctrl: SseController): void {
      clients.add(ctrl);
    },
    unsubscribe(ctrl: SseController): void {
      clients.delete(ctrl);
    },
    publish(payload: unknown): void {
      const frame = encoder.encode(formatEvent(payload));
      broadcast(frame);
    },
    /** Test-only inspection of the current subscriber count. */
    size(): number {
      return clients.size;
    },
  };
}

export type SseRegistry = ReturnType<typeof createSseRegistry>;
