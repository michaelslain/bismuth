// The cross-encoder gate: pure. Core scores the top candidates against the prompt with a reranker
// and hands the raw logits here; what survives is what gets injected.
import { tokenize } from './rank'
import type { RankedNote } from './rank'

/** How many ranked notes are shown to the reranker. */
export const RERANK_CANDIDATES = 5
/** Content terms (memory's `tokenize`) below which a prompt is terse. */
export const RERANK_TERSE_TERMS = 4
export const RERANK_CONTEXT_CHARS = 400
/** Cap on the prompt half of the query: the cross-encoder truncates the joined pair from the END at
 *  512 tokens, so an uncapped subagent prompt (a whole Agent brief) would leave no passage tokens. */
export const RERANK_QUERY_CHARS = 1000

/** The text the cross-encoder judges a passage against: the prompt itself (at most
 *  RERANK_QUERY_CHARS), or, when the prompt has fewer than RERANK_TERSE_TERMS content terms, the
 *  prompt followed by the first RERANK_CONTEXT_CHARS of the context, which leads with the agent's
 *  last reply. A terse follow-up ("ok do it") carries no topic, so the prompt alone scores about
 *  -11 against anything. */
export function rerankQuery(q: { primary: string; context?: string }): string {
    const primary = q.primary.slice(0, RERANK_QUERY_CHARS)
    const context = q.context?.trim()
    if (!context || tokenize(primary).length >= RERANK_TERSE_TERMS) return primary
    return `${primary}\n${context.slice(0, RERANK_CONTEXT_CHARS)}`
}

/** Lowest raw logit the gate admits (keyword-only picks go in regardless, see `withKeywordPicks`) (ms-marco MiniLM logits run roughly -12..+8; a relevant
 *  note often sits near -5, and a paraphrase of a rule reads -6 to -10 even when it is the right
 *  note). -6 is the lowest bar that adds no false injection on either eval suite: every logit
 *  between -6 and -7 on the synthetic suite belongs to an expect-nothing prompt except one match.
 *  Measured with `bun bench/recallEval.ts --service --embeddings on`, see docs/daemon/communication.md. */
export const RERANK_MIN_LOGIT = -6
/** A candidate this far below the top logit is dropped even when it clears `RERANK_MIN_LOGIT`. A
 *  second real match often reads 6 to 8 below a strongly matching first one (3.4 and -4.0 on the
 *  same prompt), so 6 refused it; 8 keeps it and adds no false injection. */
export const RERANK_MAX_DROP = 8

/** Keep the candidates whose logit is >= minLogit and >= top - maxDrop, best first. `[]` = the gate
 *  admits nothing. A missing or non-finite logit never qualifies; a stable order breaks ties. The
 *  gate only adds: the recall service (`withKeywordPicks` in core/src/memoryRecall.ts) injects
 *  every keyword-only pick besides what it returns, whatever logit that pick reads. */
export function gateByRerank(
    candidates: RankedNote[],
    logits: number[],
    opts: { minLogit?: number; maxDrop?: number } = {},
): RankedNote[] {
    const minLogit = opts.minLogit ?? RERANK_MIN_LOGIT
    const maxDrop = opts.maxDrop ?? RERANK_MAX_DROP
    const scored = candidates
        .map((note, i) => ({ note, logit: logits[i], i }))
        .filter((s): s is { note: RankedNote; logit: number; i: number } =>
            Number.isFinite(s.logit),
        )
        .sort((a, b) => b.logit - a.logit || a.i - b.i)
    if (!scored.length) return []
    const top = scored[0]!.logit
    return scored
        .filter(s => s.logit >= minLogit && s.logit >= top - maxDrop)
        .map(s => s.note)
}
