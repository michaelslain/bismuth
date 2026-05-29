type Ctrl = ReadableStreamDefaultController<Uint8Array>;

/** Encode a JSON payload as an SSE `data:` frame (single event, no id/event-type). */
export function formatEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Tracks connected SSE clients and broadcasts events to all of them. */
export function createSseRegistry() {
  const clients = new Set<Ctrl>();
  const encoder = new TextEncoder();

  return {
    subscribe(ctrl: Ctrl) {
      clients.add(ctrl);
    },
    unsubscribe(ctrl: Ctrl) {
      clients.delete(ctrl);
    },
    publish(payload: unknown) {
      const frame = encoder.encode(formatEvent(payload));
      for (const ctrl of clients) {
        try {
          ctrl.enqueue(frame);
        } catch {
          // Controller is closed; drop it so we don't keep failing on each publish.
          clients.delete(ctrl);
        }
      }
    },
    /** Test-only inspection of the current subscriber count. */
    size() {
      return clients.size;
    },
  };
}

export type SseRegistry = ReturnType<typeof createSseRegistry>;
