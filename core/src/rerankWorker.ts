import { runEmbedWorker } from './embedWorker'
import type { WorkerExtractor } from './embedWorker'

/** The cross-encoder child: the same newline-JSON protocol as the embedding worker
 *  (`embedWorker.ts`'s `runEmbedWorker`), with a different loader. A request's `texts` are
 *  `[query, passage1, passage2, ...]`; the reply tensor has dims `[n, 1]`, one RAW logit per passage.
 *  THIS FILE MUST NOT STATICALLY IMPORT THE MODEL PACKAGES: it is reachable from core boot via
 *  `embedWorkerBoot`. */

export const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2'
/** The argv marker the compiled sidecar is re-executed with (see `embedWorkerBoot`). */
export const RERANK_WORKER_ARG = '--bismuth-rerank-worker'

export async function loadReranker(cacheDir: string): Promise<WorkerExtractor> {
    const tf = await import('@huggingface/transformers')
    tf.env.cacheDir = cacheDir
    const session_options = {
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
        enableMemPattern: false,
    }
    const tokenizer = await tf.AutoTokenizer.from_pretrained(RERANK_MODEL)
    const model = await tf.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
        dtype: 'q8',
        session_options,
    })
    return {
        async run(texts) {
            const [query, ...passages] = texts
            if (query === undefined || passages.length === 0)
                return { data: new Float32Array(0), dims: [0, 1] }
            const inputs = tokenizer(passages.map(() => query), {
                text_pair: passages,
                padding: true,
                truncation: true,
            })
            const { logits } = await model(inputs)
            const out = { data: Float32Array.from(logits.data as Float32Array), dims: [...logits.dims] }
            logits.dispose?.()
            return out
        },
        dispose: async () => {
            await model.dispose?.()
        },
    }
}

if (import.meta.main) void runEmbedWorker(loadReranker)
