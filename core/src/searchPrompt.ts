// core/src/searchPrompt.ts
// AI prompt-search fallback: when the literal /search comes up empty for a natural-language
// question, this runs a SINGLE one-shot Agent-SDK query() (the user's own `claude`, machine-login
// auth — never an API key, exactly like chat.ts) to re-rank the MiniSearch candidates and pick the
// notes that genuinely answer the question.
//
// Anti-hallucination is structural, not hopeful:
//   1. The model may only choose from the Stage-1 candidate PATHS (rankCandidates) — any path it
//      returns that isn't in that set is rejected.
//   2. For each chosen note the model must copy a VERBATIM `quote` from that note's text; the
//      backend re-locates that quote in the REAL body via indexOf (case-insensitive fallback) and
//      rejects anything it can't find. A paraphrased/invented quote is dropped.
//   3. The rendered snippet is sliced byte-for-byte out of the real body — never from model text —
//      so SearchView renders it identically to a literal hit (same MatchSnippet shape).
//
// The daemon is deliberately NOT involved (latency + it's off by default); this path is always-on in
// every vault, gated only on Claude Code being installed (whichClaude()).
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { whichClaude } from "./claudeWhich";
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
 * Build a byte-exact single-line `MatchSnippet` for `quote` within `body`, or null if the quote
 * isn't actually present (the anti-hallucination gate). The match is located by exact indexOf, then
 * a case-insensitive fallback; either way the returned `before`/`match`/`after` are sliced from the
 * REAL body bytes around the hit (never from the model's quote), and are clamped to the single line
 * containing the hit's start so `before + match + after === body.split("\n")[line-1]` always holds —
 * exactly the shape SearchView renders. Pure + exported for tests.
 */
export function buildSnippet(body: string, quote: string): MatchSnippet | null {
  if (!quote) return null;
  let idx = body.indexOf(quote);
  const len = quote.length;
  if (idx < 0) {
    // Case-insensitive fallback: locate on the lowercased copies, then slice the REAL bytes so the
    // snippet stays byte-exact to what's actually in the file.
    const lc = body.toLowerCase().indexOf(quote.toLowerCase());
    if (lc < 0) return null;
    idx = lc;
  }
  const lineStart = body.lastIndexOf("\n", idx - 1) + 1; // 0 when there's no preceding newline
  let lineEnd = body.indexOf("\n", idx);
  if (lineEnd < 0) lineEnd = body.length;
  const matchEnd = Math.min(idx + len, lineEnd); // clamp a multi-line quote to its first line
  return {
    line: lineNumberAt(body, idx),
    before: body.slice(lineStart, idx),
    match: body.slice(idx, matchEnd),
    after: body.slice(matchEnd, lineEnd),
  };
}

/**
 * Turn raw model results into validated, byte-exact `SearchResult[]` in model order. Rejects (a) any
 * path not in `bodiesByPath` (a path the model never saw / invented) and (b) any quote not found in
 * that path's real body. At most one result per path. Pure + exported for tests.
 */
export function validateResults(raw: ModelResult[], bodiesByPath: Map<string, string>): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r.path !== "string" || typeof r.quote !== "string") continue;
    if (seen.has(r.path)) continue;
    const body = bodiesByPath.get(r.path);
    if (body === undefined) continue; // hallucinated / out-of-candidate path
    const snippet = buildSnippet(body, r.quote);
    if (!snippet) continue; // paraphrased / invented quote — not present in the real body
    seen.add(r.path);
    const reason = typeof r.reason === "string" ? r.reason.trim() : "";
    out.push({ path: r.path, matchCount: 1, snippets: [snippet], ...(reason ? { reason } : {}) });
  }
  return out;
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
  for await (const msg of iterator) {
    if (msg.type !== "result") continue;
    if (msg.subtype === "success") {
      const m = msg as { structured_output?: unknown; result?: string };
      return { structured: m.structured_output, resultText: m.result };
    }
    // error_during_execution / error_max_turns / error_max_structured_output_retries / …
    throw new AppError("INTERNAL_ERROR", `AI search did not complete (${msg.subtype})`, 500);
  }
  return { structured: undefined, resultText: undefined }; // generator ended with no result
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
  return validateResults(parseModelOutput(out.structured, out.resultText), bodiesByPath);
}
