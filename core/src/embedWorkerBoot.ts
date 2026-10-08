import { WORKER_ARG, runEmbedWorker } from './embedWorker'
import { RERANK_WORKER_ARG, loadReranker } from './rerankWorker'

/** FIRST import of server.ts. The compiled sidecar has one entrypoint, so a model child is the
 *  same binary re-executed with `WORKER_ARG` (embedder) or `RERANK_WORKER_ARG` (reranker); this
 *  turns that process into the worker instead of a second core. (In dev the child is
 *  `bun run embedWorker.ts` / `rerankWorker.ts` and never goes through here.) The rest of
 *  server.ts's import graph still evaluates, but its `import.meta.main` block checks
 *  `isEmbedWorker` and never starts a server. Neither import reaches a model package statically. */
const embedding = Bun.argv.includes(WORKER_ARG)
const reranking = Bun.argv.includes(RERANK_WORKER_ARG)
export const isEmbedWorker = embedding || reranking
if (embedding) void runEmbedWorker()
else if (reranking) void runEmbedWorker(loadReranker)
