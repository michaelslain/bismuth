import type { DenyEntry } from './visibility'

/** The shared shapes of the semantic sources recall and `bismuth search` draw from beyond memory:
 *  vault files (notes, PDFs, described images), past chats and Bismuth's own docs. Each source module
 *  (`vaultEmbed.ts`, `chatEmbed.ts`, `docsEmbed.ts`) ranks against a query vector the caller embedded
 *  once, so one prompt costs one embedding however many sources it reaches. */

export type SourceKind = 'note' | 'pdf' | 'image' | 'chat' | 'docs'

export type SourceHit = {
    kind: SourceKind
    /** note / pdf / image: the vault-relative path of the file itself (an image's binary, never its
     *  companion note). chat: the session id. docs: the docs-relative page path, with `#anchor` when
     *  the hit is one section. */
    id: string
    /** Cosine of the best chunk against the query. */
    score: number
    /** The best chunk, whitespace collapsed, at most `SOURCE_EXCERPT_CHARS`. */
    excerpt: string
    /** pdf: the 1-based page the best chunk sits on. */
    page?: number
    /** chat: the session's local date, YYYY-MM-DD. */
    date?: string
    /** note: its title; docs: the page or section title. */
    title?: string
    /** Content hash of what produced the hit, so recall's ledger re-sends it only after it changes. */
    hash: string
}

export type SourceQuery = {
    /** The query embedding (QUERY_PREFIX applied), from the shared embedder. */
    vec: Float32Array
    /** Most hits to return, after visibility filtering. */
    k: number
    /** Whose view: `chat` hides `hidden`, `daemon` hides `hidden` and `chat-only`. */
    channel: 'chat' | 'daemon'
    /** File deny entries for the caller; denied files are dropped before `k` is applied. */
    deny?: DenyEntry[]
    /** chat: the session asking, left out of its own results. */
    excludeSessionId?: string
}

export const SOURCE_EXCERPT_CHARS = 300

/** The ledger key recall dedups a source hit by: `kind:id`. */
export const sourceKey = (h: Pick<SourceHit, 'kind' | 'id'>): string => `${h.kind}:${h.id}`
