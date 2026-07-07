// core/src/searchPrompt.ts
// AI prompt-search fallback: when the literal /search comes up empty for a natural-language
// question, this runs a SINGLE one-shot Agent-SDK query() (the user's own `claude`, machine-login
// auth — never an API key, exactly like chat.ts) to re-rank the MiniSearch candidates and pick the
// notes that genuinely answer the question.
//
// Anti-hallucination is structural, not hopeful — but the SECURITY boundary is the PATH, not the
// quote. Loosening the quote check (BUG #8) is safe because every rendered snippet is still sliced
// byte-for-byte out of the REAL body, never from model text:
//   1. The model may only choose from the Stage-1 candidate PATHS (rankCandidates) — any path it
//      returns that isn't in that set is rejected outright. This is the only hard rejection.
//   2. For each chosen note we try to locate the model's `quote` in the REAL body to highlight the
//      exact span: verbatim indexOf, then case-insensitive, then WHITESPACE-NORMALIZED (the model
//      routinely reflows a note's hard-wrapped newlines into spaces, so an exact/CI indexOf misses
//      even though every word is present in order — this was silently rejecting ~every result).
//   3. If the quote can't be located even after normalization, we DO NOT drop the result — the path
//      is already validated, so we derive a snippet from the real body around the best shared keyword
//      (from the quote, then the question), falling back to the note's first line. The user always
//      sees the notes the model chose, with a real body snippet.
//   4. Every snippet's before/match/after is sliced from the real body bytes — SearchView renders it
//      identically to a literal hit (same MatchSnippet shape).
//
// The daemon is deliberately NOT involved (latency + it's off by default); this path is always-on in
// every vault, gated only on Claude Code being installed (whichClaude()).
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeSpawnEnv, whichClaude } from "./claudeWhich";
import { AppError } from "./error";
import { rankCandidates } from "./search";
import type { MatchSnippet, SearchResult } from "./search";

/** The Haiku model — cheap + fast + supports structured outputs (the user explicitly asked for it). */
const HAIKU_MODEL = "claude-haiku-4-5";

// Context bounds: never the whole vault. At most MAX_CANDIDATES notes, each truncated to
// PER_FILE_EXCERPT_CHARS, and the whole context hard-capped at TOTAL_CONTEXT_CHARS so a single turn
// stays ~<=10K tokens (≈4 chars/token) regardless of note sizes.
const MAX_CANDIDATES = 30;
const PER_FILE_EXCERPT_CHARS = 1200;
const TOTAL_CONTEXT_CHARS = 36_000;

/** Plain-string system prompt (a few hundred tokens): re-ranking instructions + the verbatim rule. */
const SYSTEM_PROMPT =
  "You re-rank vault note search candidates for a natural-language question. You are given the " +
  "question and a numbered list of candidate notes, each with its exact path and an excerpt of its " +
  "text. Return ONLY the notes that genuinely answer the question, best first. For each returned " +
  "note: set `path` to that candidate's exact path (copied verbatim), set `quote` to a short span " +
  "copied VERBATIM from that note's excerpt (an exact substring — never paraphrase, summarize, " +
  "translate, or fix typos), and set `reason` to one short line on why it answers the question. " +
  "Only use paths from the provided candidates. If none answer the question, return an empty list.";

/** The json_schema the SDK enforces on the structured output. */
const RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "quote"],
        properties: {
          path: { type: "string", description: "Exact path of a candidate note that answers the question." },
          quote: { type: "string", description: "A span copied verbatim from that note's text." },
          reason: { type: "string", description: "One short line on why it answers the question." },
        },
      },
    },
  },
};

/** One raw result off the model, before validation. */
export interface ModelResult {
  path: string;
  quote: string;
  reason?: string;
}

// The SDK boundary, isolated behind an overridable seam so tests exercise the whole flow
// (candidate bounding + parse + validate + byte-exact snippets) WITHOUT spawning `claude`.
export type ModelRunner = (args: {
  bin: string;
  root: string;
  question: string;
  context: string;
  signal?: AbortSignal;
}) => Promise<{ structured: unknown; resultText: string | undefined }>;

/**
 * Build the bounded model context from ranked candidates. Returns the serialized context string AND
 * `bodiesByPath` — the map of path → FULL body used for verbatim validation. Only candidates whose
 * block actually made it into the context are in the map, so the validated candidate set is exactly
 * what the model saw (a path it never saw can't be validated). The excerpt is a prefix of the full
 * body, so any quote the model copies from the excerpt is still found in the full body. Pure.
 */
export function buildCandidateContext(
  cands: { path: string; body: string }[],
): { context: string; bodiesByPath: Map<string, string> } {
  const bodiesByPath = new Map<string, string>();
  const blocks: string[] = [];
  let total = 0;
  for (const c of cands.slice(0, MAX_CANDIDATES)) {
    if (bodiesByPath.has(c.path)) continue; // dedupe (rankCandidates is already unique, but be safe)
    const excerpt = c.body.slice(0, PER_FILE_EXCERPT_CHARS);
    const block = `--- path: ${c.path} ---\n${excerpt}`;
    // Keep at least one candidate even if it alone exceeds the cap; otherwise stop before overflow.
    if (blocks.length > 0 && total + block.length > TOTAL_CONTEXT_CHARS) break;
    blocks.push(block);
    bodiesByPath.set(c.path, c.body);
    total += block.length;
  }
  return { context: blocks.join("\n\n"), bodiesByPath };
}

/** Assemble the one-shot user prompt from the question + serialized candidate context. Pure. */
export function buildPrompt(question: string, context: string): string {
  return `Question: ${question}\n\nCandidate notes:\n${context}`;
}

/** Coerce an unknown value into `ModelResult[]` if it's shaped like `{results:[...]}` or a bare
 *  array of `{path,quote}`. Returns null when it isn't that shape at all (so the caller can fall
 *  back to text parsing); returns `[]` when it IS the shape but carries no usable items. Pure. */
function coerceResults(v: unknown): ModelResult[] | null {
  if (!v || typeof v !== "object") return null;
  const arr: unknown = Array.isArray(v) ? v : (v as { results?: unknown }).results;
  if (!Array.isArray(arr)) return null;
  const out: ModelResult[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== "string" || typeof o.quote !== "string") continue;
    out.push({ path: o.path, quote: o.quote, ...(typeof o.reason === "string" ? { reason: o.reason } : {}) });
  }
  return out;
}

/** Best-effort JSON extraction from a text result (fallback when structured_output is absent).
 *  Tries a clean parse, then a ```json fence, then the first-brace..last-brace substring. Pure. */
function tolerantJsonParse(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const s = trimmed.indexOf("{");
  const e = trimmed.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(trimmed.slice(s, e + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Parse the model's output into raw `ModelResult[]`. Prefers the SDK `structured_output` (from the
 * json_schema outputFormat); falls back to tolerant JSON extraction from the `result` text for CLI
 * builds that don't populate `structured_output`. Never throws — a garbage result yields []. Pure.
 */
export function parseModelOutput(structured: unknown, resultText: string | undefined): ModelResult[] {
  const fromStructured = coerceResults(structured);
  if (fromStructured) return fromStructured;
  if (typeof resultText === "string" && resultText.trim()) {
    const fromText = coerceResults(tolerantJsonParse(resultText));
    if (fromText) return fromText;
  }
  return [];
}

/** 1-based line number of byte offset `idx` in `body` (matches findMatches' split("\n") numbering). */
function lineNumberAt(body: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (body[i] === "\n") n++;
  return n;
}

/**
 * Build the clamped single-line `MatchSnippet` for the ORIGINAL byte range `[start, end)` of `body`.
 * `before`/`match`/`after` are sliced from the real body bytes and clamped to the single line
 * containing `start`, so `before + match + after === body.split("\n")[line-1]` always holds — exactly
 * the shape SearchView renders. A range spanning multiple lines shows just its first line.
 */
function snippetAt(body: string, start: number, end: number): MatchSnippet {
  const lineStart = body.lastIndexOf("\n", start - 1) + 1; // 0 when there's no preceding newline
  let lineEnd = body.indexOf("\n", start);
  if (lineEnd < 0) lineEnd = body.length;
  const matchEnd = Math.min(end, lineEnd); // clamp a multi-line span to its first line
  return {
    line: lineNumberAt(body, start),
    before: body.slice(lineStart, start),
    match: body.slice(start, matchEnd),
    after: body.slice(matchEnd, lineEnd),
  };
}

/**
 * Collapse every run of whitespace in `body` to a single space, returning the normalized string plus
 * a map from each normalized-char index back to the ORIGINAL body index it came from (a whitespace
 * run maps to the run's first byte). Lets us locate a quote whose whitespace the model reflowed —
 * hard-wrapped newlines collapsed into spaces is the overwhelmingly common case — while still slicing
 * the rendered snippet out of the real bytes. Pure.
 */
function normalizeWithMap(body: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  const n = body.length;
  let i = 0;
  while (i < n) {
    if (/\s/.test(body[i])) {
      map.push(i);
      norm += " ";
      i++;
      while (i < n && /\s/.test(body[i])) i++; // swallow the rest of the whitespace run
    } else {
      map.push(i);
      norm += body[i];
      i++;
    }
  }
  return { norm, map };
}

/**
 * Locate `quote` in `body` ignoring case AND whitespace differences (collapsed runs / reflowed
 * newlines). Returns the ORIGINAL `[start, end)` byte range of the match, or null. Pure.
 */
function locateNormalized(body: string, quote: string): { start: number; end: number } | null {
  const q = quote.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const { norm, map } = normalizeWithMap(body);
  const ni = norm.toLowerCase().indexOf(q.toLowerCase());
  if (ni < 0) return null;
  const start = map[ni];
  // The last matched normalized char is non-whitespace (q is trimmed), so it occupies exactly one
  // original byte — its end is map[last] + 1.
  const end = map[ni + q.length - 1] + 1;
  return { start, end };
}

/**
 * Build a byte-exact single-line `MatchSnippet` for `quote` within `body`, or null if the quote
 * can't be located at all. Tries exact indexOf, then case-insensitive, then whitespace-normalized —
 * the returned `before`/`match`/`after` are always sliced from the REAL body bytes around the hit
 * (never from the model's quote). Pure + exported for tests.
 */
export function buildSnippet(body: string, quote: string): MatchSnippet | null {
  if (!quote) return null;
  const exact = body.indexOf(quote);
  if (exact >= 0) return snippetAt(body, exact, exact + quote.length);
  const ci = body.toLowerCase().indexOf(quote.toLowerCase()); // same length as quote → end = ci+len
  if (ci >= 0) return snippetAt(body, ci, ci + quote.length);
  const located = locateNormalized(body, quote);
  if (located) return snippetAt(body, located.start, located.end);
  return null;
}

// Short function/stop words that make poor snippet anchors — skipped when deriving a fallback
// keyword so we don't highlight "the"/"with"/"about" instead of the real subject.
const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "along", "among", "around", "because", "been",
  "before", "being", "below", "between", "both", "does", "doing", "during", "each", "from", "have",
  "having", "here", "into", "just", "like", "more", "most", "much", "only", "other", "over", "same",
  "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "under", "until", "very", "were", "what", "when", "where", "which", "while", "with",
  "would", "your", "yours", "note", "notes", "write", "wrote", "written",
]);

/**
 * Distinctive lowercased word tokens from `text`, longest first (content words outrank short
 * function words) and deduped — candidate anchors for a body-derived fallback snippet. Pure.
 */
function keywordsOf(text: string): string[] {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter(
    (w) => w.length >= 4 && !STOPWORDS.has(w),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) if (!seen.has(w)) { seen.add(w); out.push(w); }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/**
 * Fallback snippet for a validated candidate whose quote couldn't be located verbatim: highlight the
 * first `keywords` term that appears in the body (case-insensitive). Returns null if none match. Pure.
 */
function deriveKeywordSnippet(body: string, keywords: string[]): MatchSnippet | null {
  const lc = body.toLowerCase();
  for (const kw of keywords) {
    const idx = lc.indexOf(kw);
    if (idx >= 0) return snippetAt(body, idx, idx + kw.length);
  }
  return null;
}

/**
 * Last-resort snippet: the note's first non-blank line as a plain (un-highlighted) preview, so a
 * validated candidate is NEVER dropped just because we couldn't pin a span. Returns null for an
 * all-blank body. Pure.
 */
function previewSnippet(body: string): MatchSnippet | null {
  const lines = body.split("\n");
  let off = 0;
  for (const line of lines) {
    if (line.trim()) {
      return { line: lineNumberAt(body, off), before: "", match: "", after: line };
    }
    off += line.length + 1; // +1 for the "\n" split removed
  }
  return null;
}

/**
 * Best available byte-exact snippet for a validated candidate: the located quote if possible, else a
 * keyword-derived snippet (quote words, then question words), else the first-line preview. Returns
 * null only when the body is empty/all-blank. Pure + exported for tests.
 */
export function bestSnippet(body: string, quote: string, question = ""): MatchSnippet | null {
  return (
    buildSnippet(body, quote) ??
    deriveKeywordSnippet(body, [...keywordsOf(quote), ...keywordsOf(question)]) ??
    previewSnippet(body)
  );
}

/**
 * Turn raw model results into validated, byte-exact `SearchResult[]` in model order. The ONLY hard
 * rejection is a path not in `bodiesByPath` (a path the model never saw / invented) — the security
 * boundary. A result whose `quote` can't be located verbatim is NOT dropped (BUG #8: paraphrased /
 * reflowed quotes were nuking every result); instead `bestSnippet` derives a real body snippet around
 * the best shared keyword, falling back to the note's first line. `question` seeds that keyword
 * fallback. At most one result per path; a truly empty body is skipped. Pure + exported for tests.
 */
export function validateResults(
  raw: ModelResult[],
  bodiesByPath: Map<string, string>,
  question = "",
): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r.path !== "string" || typeof r.quote !== "string") continue;
    if (seen.has(r.path)) continue;
    const body = bodiesByPath.get(r.path);
    if (body === undefined) continue; // hallucinated / out-of-candidate path — the one hard reject
    const snippet = bestSnippet(body, r.quote, question);
    if (!snippet) continue; // empty/all-blank body — nothing to show
    seen.add(r.path);
    const reason = typeof r.reason === "string" ? r.reason.trim() : "";
    out.push({ path: r.path, matchCount: 1, snippets: [snippet], ...(reason ? { reason } : {}) });
  }
  return out;
}

/**
 * Consume a one-shot query() message stream down to its terminal "result" message, returning the
 * structured/text payload. Extracted from runModelReal so this exact anomaly-handling logic is
 * unit-testable against a synthetic message stream, without mocking the SDK's query() construction.
 *
 * BUG #8 (3rd bounce) ROOT CAUSE: this used to let the stream end WITHOUT ever seeing a "result"
 * message fall through to `return { structured: undefined, resultText: undefined }` — a silent
 * "no answer" that validateResults()/parseModelOutput() turn into an empty `[]`, RENDERED IDENTICALLY
 * to "the AI ran and genuinely found nothing relevant". But the `claude` child process can end the
 * stream without a result message for many reasons that have NOTHING to do with the question having
 * no answer: not logged in, a killed/crashed process, an unexpected CLI output shape, a spawn that
 * failed only after the async iterable started. Every one of those was previously indistinguishable
 * from a correct empty search — exactly the kind of silent failure that kept this row bouncing. Now
 * treated as a hard error, same as chat.ts's `drain()` loop (core/src/chat.ts) treating a generator
 * that ends on its own (not via our own close()) as an `exit` error frame rather than pretending
 * nothing happened.
 */
export async function consumeModelStream(
  iterator: AsyncIterable<SDKMessage>,
): Promise<{ structured: unknown; resultText: string | undefined }> {
  for await (const msg of iterator) {
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      const m = msg as { structured_output?: unknown; result?: string; is_error?: boolean };
      // BUG #8 (4th bounce) ROOT CAUSE: `claude` reports a broken invocation — e.g. "Not logged in ·
      // Please run /login" when the spawned child's env is missing $USER (see claudeSpawnEnv in
      // claudeWhich.ts) — as a perfectly normal `subtype: "success"` message with `is_error: true`
      // and the failure text in `result`. The 3rd-bounce fix above only checked `subtype`, so this
      // "successful failure" sailed through: `result` (not JSON) failed to parse in
      // parseModelOutput → silently coerced to `[]` → rendered as "Bismuth AI found nothing
      // relevant", INDISTINGUISHABLE from a real empty answer. Treat `is_error` as a hard error too.
      if (m.is_error) {
        throw new AppError("INTERNAL_ERROR", `AI search failed: ${m.result || "unknown error"}`, 500);
      }
      return { structured: m.structured_output, resultText: m.result };
    }
    // error_during_execution / error_max_turns / error_max_structured_output_retries / …
    throw new AppError("INTERNAL_ERROR", `AI search did not complete (${msg.subtype})`, 500);
  }
  // The generator ended without ever emitting a "result" message — see the doc comment above.
  throw new AppError(
    "INTERNAL_ERROR",
    "AI search ended without a response from Claude Code — check that `claude` is installed and you're logged in, then try again",
    500,
  );
}

/** The real SDK model runner: one-shot query() over the user's `claude`, structured JSON out. */
const runModelReal: ModelRunner = async ({ bin, root, question, context, signal }) => {
  const abort = new AbortController();
  if (signal) {
    if (signal.aborted) abort.abort();
    else signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  let iterator: AsyncIterable<SDKMessage>;
  try {
    iterator = query({
      prompt: buildPrompt(question, context),
      options: {
        model: HAIKU_MODEL,
        pathToClaudeCodeExecutable: bin,
        cwd: root,
        // BUG #8 (4th bounce): the SDK's `env` REPLACES the child's env entirely when set (never
        // merged with process.env) — so if we omitted this, the child would just inherit whatever
        // env THIS server process happens to have, verbatim. Fine in dev; not safe to assume for a
        // packaged sidecar. claudeSpawnEnv (see its doc comment in claudeWhich.ts) fills the exact
        // gaps that break `claude`'s own Keychain-login lookup when they're missing: $USER/$LOGNAME
        // (the lookup account) and a $PATH that includes `/usr/bin` (where `security` lives) —
        // without either, `claude` reports "Not logged in" even though the user genuinely is.
        env: claudeSpawnEnv(),
        // No tools, one turn, no session persistence, no filesystem settings (no CLAUDE.md/skills):
        // a lean, isolated, cheap one-shot — mirrors chat.ts's query() but stripped to the minimum.
        tools: [],
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        systemPrompt: SYSTEM_PROMPT,
        abortController: abort,
        outputFormat: { type: "json_schema", schema: RESULT_SCHEMA },
      },
    }) as unknown as AsyncIterable<SDKMessage>;
  } catch (e) {
    // Same construction-error handling shape as chat.ts:548-551.
    throw new AppError("INTERNAL_ERROR", `AI search failed to start: ${(e as Error).message}`, 500);
  }
  return consumeModelStream(iterator);
};

/**
 * Overridable dependency seam (mirrors how the rest of core keeps its `claude` boundary swappable):
 * tests point `whichClaude` at a stub to exercise the no-claude 400, and point `runModel` at a
 * canned model output to exercise the full parse→validate→snippet pipeline without spawning `claude`.
 */
export const searchPromptDeps: { whichClaude: () => string | null; runModel: ModelRunner } = {
  whichClaude,
  runModel: runModelReal,
};

/**
 * AI prompt search: rank candidates, bound the context, ask Haiku to pick + quote, validate to
 * byte-exact `SearchResult[]`. Throws AppError("EINVAL", 400) when Claude Code isn't installed, and
 * AppError("INTERNAL_ERROR", 500) on a model failure. Returns [] when there are no candidates.
 */
export async function promptSearch(root: string, question: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const bin = searchPromptDeps.whichClaude();
  if (!bin) throw new AppError("EINVAL", "AI search needs Claude Code installed", 400);
  const q = question.trim();
  if (!q) return [];
  const cands = await rankCandidates(root, q, MAX_CANDIDATES);
  if (cands.length === 0) return [];
  const { context, bodiesByPath } = buildCandidateContext(cands);
  let out: { structured: unknown; resultText: string | undefined };
  try {
    out = await searchPromptDeps.runModel({ bin, root, question: q, context, signal });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INTERNAL_ERROR", `AI search failed: ${(e as Error).message}`, 500);
  }
  return validateResults(parseModelOutput(out.structured, out.resultText), bodiesByPath, q);
}
