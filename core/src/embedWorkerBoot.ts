import { WORKER_ARG, runEmbedWorker } from './embedWorker'

/** FIRST import of server.ts. The compiled sidecar has one entrypoint, so the embedding child is the
 *  same binary re-executed with `WORKER_ARG`; this turns that process into the worker instead of a
 *  second core. (In dev the child is `bun run embedWorker.ts` and never goes through here.) The rest
 *  of server.ts's import graph still evaluates, but its `import.meta.main` block checks
 *  `isEmbedWorker` and never starts a server. */
export const isEmbedWorker = Bun.argv.includes(WORKER_ARG)
if (isEmbedWorker) void runEmbedWorker()
