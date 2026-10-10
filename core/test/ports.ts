/**
 * A loopback port nothing listens on right now. Several suites run at once on one machine (other
 * worktrees' sessions, `bun test --parallel`), so a hardcoded port collides: the second bind fails,
 * or worse, a test's readiness probe reaches ANOTHER suite's server and asserts against its vault.
 *
 * For an in-process `Bun.serve`, pass `port: 0` and read `server.port` instead. Use this for a port
 * handed to a subprocess (`core/src/server.ts --port`) or for one that must have no listener.
 */
export function freePort(): number {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
    const port = probe.port
    probe.stop(true)
    if (port === undefined) throw new Error('freePort: Bun.serve bound no port')
    return port
}
