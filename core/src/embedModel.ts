/** Which model recall and search embed with, how it pools, and the prefixes it was trained with. A
 *  module of its own so the worker and `memoryEmbed` agree without one importing the other. */

export type EmbedSpec = {
    /** Hugging Face id, loaded through transformers.js. */
    id: string
    pooling: 'cls' | 'mean'
    /** Put before every query. */
    query: string
    /** Put before every passage the store embeds. */
    doc: string
    dtype: 'q8' | 'fp32' | 'fp16' | 'q4'
}

const BGE_QUERY = 'Represent this sentence for searching relevant passages: '

/** The embedders `bench/searchReplay.ts` compares; `default` is the one that ships. */
export const EMBED_SPECS: Record<string, EmbedSpec> = {
    default: { id: 'Xenova/bge-small-en-v1.5', pooling: 'cls', query: BGE_QUERY, doc: '', dtype: 'q8' },
    'bge-base': { id: 'Xenova/bge-base-en-v1.5', pooling: 'cls', query: BGE_QUERY, doc: '', dtype: 'q8' },
    'arctic-m': {
        id: 'Snowflake/snowflake-arctic-embed-m-v1.5',
        pooling: 'cls',
        query: BGE_QUERY,
        doc: '',
        dtype: 'q8',
    },
    'nomic-v1.5': {
        id: 'nomic-ai/nomic-embed-text-v1.5',
        pooling: 'mean',
        query: 'search_query: ',
        doc: 'search_document: ',
        dtype: 'q8',
    },
}

/** Where `bench/finetuneEmbed.ts` exports a fine-tuned copy of the default model, under the model
 *  cache (`~/.bismuth/models`), which transformers.js reads before the network. */
export const FINETUNE_PREFIX = 'bismuth-ft/'

/** The spec a `BISMUTH_EMBED_MODEL` value names: a catalog entry, or `ft:<name>` for a fine-tuned copy
 *  of the default model at `<model cache>/bismuth-ft/<name>` (same pooling and prefixes). Anything else
 *  is the shipped model. */
export function embedSpecFor(name: string | undefined): EmbedSpec {
    const ft = /^ft:([\w.-]+)$/.exec(name ?? '')
    if (ft) return { ...EMBED_SPECS.default!, id: FINETUNE_PREFIX + ft[1] }
    return EMBED_SPECS[name ?? ''] ?? EMBED_SPECS.default!
}

/** `BISMUTH_EMBED_MODEL` picks the model for a bench run. The store keys its vectors by model id, so a
 *  switch re-embeds instead of mixing spaces. */
export const EMBED_SPEC: EmbedSpec = embedSpecFor(process.env.BISMUTH_EMBED_MODEL)
export const EMBED_MODEL = EMBED_SPEC.id
