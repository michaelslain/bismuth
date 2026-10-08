import { writeSync } from 'node:fs'
import { EMBED_MODEL } from './embedModel'

/** The child process that holds the embedding model. The model lives out here, not in core, because
 *  freeing it in-process does not return the memory (ort's arenas and the mapped dylib stay resident
 *  on macOS); a process that exits does. Protocol: newline-delimited JSON on stdin/stdout.
 *    child → parent  {ready:true}                         once the model is loaded
 *                    {ready:false, error}                 and exit(1), if it could not load
 *    parent → child  {id, texts}
 *    child → parent  {id, dims, data}  data = base64 of the row-major Float32 tensor
 *                    {id, error}
 *  stdin closing (parent exit, crash, or dispose) ends the process. THIS FILE MUST NOT STATICALLY
 *  IMPORT THE MODEL PACKAGES: it is reachable from core boot via `embedWorkerBoot`. */

export type WorkerExtractor = {
    run(texts: string[]): Promise<{ data: Float32Array; dims: number[] }>
    dispose(): Promise<void> | void
}
export type WorkerLoader = (cacheDir: string) => Promise<WorkerExtractor>

/** The argv marker the compiled sidecar is re-executed with (see `embedWorkerBoot`). */
export const WORKER_ARG = '--bismuth-embed-worker'

export async function loadTransformers(cacheDir: string): Promise<WorkerExtractor> {
    const tf = await import('@huggingface/transformers')
    tf.env.cacheDir = cacheDir
    const pipe = await tf.pipeline('feature-extraction', EMBED_MODEL, {
        dtype: 'q8',
        // Two intra-op threads: embedding is bursty and the user does not want the fans on.
        session_options: {
            intraOpNumThreads: 2,
            interOpNumThreads: 1,
            enableCpuMemArena: false,
            enableMemPattern: false,
        },
    })
    return {
        async run(texts) {
            const t = await pipe(texts, { pooling: 'cls', normalize: true })
            const out = { data: Float32Array.from(t.data as Float32Array), dims: [...t.dims] }
            t.dispose?.()
            return out
        },
        dispose: () => pipe.dispose(),
    }
}

/** Serve requests until stdin closes. Never returns normally: the process exits. */
export async function runEmbedWorker(load: WorkerLoader = loadTransformers): Promise<void> {
    // fd 1 is the protocol channel: anything a library logs must not corrupt it.
    const send = (m: object) => writeSync(1, JSON.stringify(m) + '\n')
    console.log = console.info = console.warn = (...a: unknown[]) => console.error(...a)

    let extractor: WorkerExtractor
    try {
        extractor = await load(process.env.BISMUTH_EMBED_CACHE ?? '')
    } catch (err) {
        send({ ready: false, error: String((err as Error)?.message ?? err) })
        process.exit(1)
    }
    send({ ready: true })

    let buf = ''
    const dec = new TextDecoder()
    let chain: Promise<void> = Promise.resolve()
    const reader = Bun.stdin.stream().getReader()
    for (;;) {
        const { done, value: chunk } = await reader.read()
        if (done) break
        buf += dec.decode(chunk, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl)
            buf = buf.slice(nl + 1)
            if (!line.trim()) continue
            const req = JSON.parse(line) as { id: number; texts: string[] }
            chain = chain.then(async () => {
                try {
                    const { data, dims } = await extractor.run(req.texts)
                    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                    send({ id: req.id, dims, data: bytes.toString('base64') })
                } catch (err) {
                    send({ id: req.id, error: String((err as Error)?.message ?? err) })
                }
            })
        }
    }
    // stdin closed: the parent is gone or let us go.
    await chain
    process.exit(0)
}

if (import.meta.main) void runEmbedWorker()
