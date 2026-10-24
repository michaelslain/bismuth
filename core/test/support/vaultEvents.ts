// core/test/support/vaultEvents.ts
// A server's GET /events stream, read in the background, for tests that wait on the vault watcher.
//
// A fixed sleep is the wrong wait for the watcher. Its FSEvents stream goes live anywhere from
// well under a second to over three seconds after boot on a loaded machine, and when it does it
// delivers the writes made just before it started (the vault's own fixture files) as if they were
// new. Both end at one observable point: a file written now is named in a frame. FSEvents reports
// in order and the server flushes its debounce batches in order, so by the time that frame lands,
// everything the watcher was going to report from before the write has been published. `quiesce`
// writes such a marker and waits for it; an "and nothing else happened" assertion brackets its
// action between two quiesces instead of sleeping past a debounce.
//
// A server with a memory dir runs a second watcher, and Bun serves every recursive watch in a
// process from one FSEvents stream that it rebuilds when a watch is added. Under load the rebuild
// for the memory watch can land after the vault watch is already live, and the vault events in
// flight across it are lost. So `quiesce` first waits for both watchers to go live: each one keeps
// a probe file (core/src/liveWatch.ts, PROBE_PREFIX) in its root until its own stream reports it.
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type VaultFrame = {
    version: number
    paths: string[]
    dirty?: { graph: boolean; tree: boolean }
}

// One wait covers the watcher going live (measured up to 3.3s under load), the 250ms debounce and
// the classify, about four times over. It only runs out when the frame is never coming.
export const WATCH_TIMEOUT_MS = 15_000
// A test's own timeout must outlast a wait's, or Bun's generic timeout hides the frames seen and
// starts the next test while this one's server is still watching.
export const WATCH_TEST_TIMEOUT_MS = 30_000

export type VaultEvents = {
    /** Every data frame received, in arrival order. */
    frames: VaultFrame[]
    /** The first frame at index `from` or later that `match` accepts, already received or yet to
     *  arrive. Rejects after WATCH_TIMEOUT_MS, listing the frames that did arrive. */
    waitFor(
        match: (f: VaultFrame) => boolean,
        what: string,
        from?: number,
    ): Promise<VaultFrame>
    waitForPath(path: string, from?: number): Promise<VaultFrame>
    /** The index just past `frame`, for a later wait or a count that must not include it. */
    after(frame: VaultFrame): number
    /** Waits for the vault and memory watchers to go live, then writes a marker file into the
     *  vault and waits for its frame: everything the watcher saw before the call is published. Returns the index just past that frame.
     *  The marker is a non-note file at the root, so it dirties the tree and graph but is never
     *  parsed as a note. */
    quiesce(): Promise<number>
    close(): Promise<void>
}

let markerSeq = 0
const PROBE_PREFIX = '.bismuth-watch-probe-'

async function watchersLive(dirs: string[]): Promise<void> {
    const deadline = Date.now() + WATCH_TIMEOUT_MS
    const probing = () =>
        dirs.filter(d => readdirSync(d).some(n => n.startsWith(PROBE_PREFIX)))
    for (let left = probing(); left.length; left = probing()) {
        if (Date.now() > deadline)
            throw new Error(
                `the watcher on ${left.join(', ')} did not go live within ${WATCH_TIMEOUT_MS}ms`,
            )
        await new Promise(r => setTimeout(r, 25))
    }
}

export async function openVaultEvents(
    base: string,
    vault: string,
    memory?: string,
): Promise<VaultEvents> {
    const res = await fetch(`${base}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const frames: VaultFrame[] = []
    const waiters = new Set<(f: VaultFrame, i: number) => void>()

    const pump = (async () => {
        let buf = ''
        while (true) {
            const { value, done } = await reader.read()
            if (done) return
            buf += decoder.decode(value, { stream: true })
            const parts = buf.split('\n\n')
            buf = parts.pop() ?? ''
            for (const part of parts) {
                if (!part.startsWith('data: ')) continue // `: keepalive` comments
                const frame = JSON.parse(part.slice(6)) as VaultFrame
                frames.push(frame)
                for (const w of [...waiters]) w(frame, frames.length - 1)
            }
        }
    })().catch(() => {}) // a cancelled reader rejects its pending read

    const waitFor: VaultEvents['waitFor'] = (match, what, from = 0) => {
        const hit = frames.slice(from).find(match)
        if (hit) return Promise.resolve(hit)
        return new Promise((resolve, reject) => {
            const waiter = (f: VaultFrame, i: number) => {
                if (i < from || !match(f)) return
                waiters.delete(waiter)
                clearTimeout(timer)
                resolve(f)
            }
            const timer = setTimeout(() => {
                waiters.delete(waiter)
                reject(
                    new Error(
                        `no SSE frame for ${what} within ${WATCH_TIMEOUT_MS}ms (from frame ${from}); frames: ${JSON.stringify(frames)}`,
                    ),
                )
            }, WATCH_TIMEOUT_MS)
            waiters.add(waiter)
        })
    }

    const after = (frame: VaultFrame) => frames.indexOf(frame) + 1

    return {
        frames,
        waitFor,
        waitForPath: (path, from = 0) =>
            waitFor(f => f.paths.includes(path), path, from),
        after,
        async quiesce() {
            await watchersLive(memory ? [vault, memory] : [vault])
            const marker = `watch-marker-${process.pid}-${++markerSeq}.txt`
            writeFileSync(join(vault, marker), '')
            return after(
                await waitFor(
                    f => f.paths.includes(marker),
                    `marker ${marker}`,
                ),
            )
        },
        async close() {
            await reader.cancel().catch(() => {})
            await pump
        },
    }
}
