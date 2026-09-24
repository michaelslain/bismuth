// Shared across KanbanView.stories.tsx / KanbanColumns.stories.tsx / KanbanStoredRows.stories.tsx.
// `fakeTransport` gives every route a generic 200 ack with no record of the call — enough for a
// story that only needs the write to succeed, not enough to ASSERT what was written. Wraps it
// with a `post`/`put` spy (the verb `setViewProperty`/`rowCreate`/`rowUpdate` all go through) so a
// play() can inspect exactly what was sent.
import { fakeTransport } from './_fakeTransport'
import type { FakeTransportSeed } from './_fakeTransport'
import type { Transport } from '../api'

export function spiedTransport(seed: FakeTransportSeed = {}): {
    transport: Transport
    calls: { path: string; body: unknown }[]
} {
    const calls: { path: string; body: unknown }[] = []
    const base = fakeTransport(seed)
    const transport: Transport = {
        ...base,
        post: async (path, body) => {
            calls.push({ path, body })
            return base.post(path, body)
        },
        put: async (path, body) => {
            calls.push({ path, body })
            return base.put(path, body)
        },
    }
    return { transport, calls }
}
