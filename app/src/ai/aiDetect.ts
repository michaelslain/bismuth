// Local, offline AI-generated-text detector → a whole-document P(AI) in [0,1].
//
// Runs ENTIRELY on-device via transformers.js (onnxruntime-web WASM) in the FRONTEND
// (webview) — never in core. WASM doesn't load from the bun-compiled core sidecar (the
// same "$bunfs WASM path bug" that keeps Harper frontend-only), and the webview is a real
// browser where onnxruntime-web just works. Lazy-loaded + code-split so it costs nothing at
// boot; the ~34MB int8 model downloads on FIRST use and is cached by transformers.js, so
// nothing big ships bundled and later runs are effectively offline.
//
// Model: onnx-community/e5-small-lora-ai-generated-detector-ONNX (LABEL_0 = human,
// LABEL_1 = AI). Trained on the RAID corpus, which contains NO Claude — so it is NOT
// validated on Claude-class text and is unreliable on edited/paraphrased prose. This is a
// rough hint, never proof. The UI must say so. See the research notes from 2026-06-15.

import { stripFrontmatter } from "../bases/cardBodySplit";

// The int8 quantized variant (model_quantized.onnx, ~34MB).
const MODEL_ID = "onnx-community/e5-small-lora-ai-generated-detector-ONNX";
// e5-small max sequence length is 512 tokens; keep each window well under that (~1.3
// tokens/word) so nothing is silently truncated. Score the doc as the mean over windows.
const WORDS_PER_CHUNK = 280;
// Cap work on very long essays — sample this many windows evenly across the document.
const MAX_CHUNKS = 16;
// Below this, the score is noise (these models need a few hundred chars to mean anything).
const MIN_WORDS = 40;

export interface AiDetectResult {
  /** Mean P(AI-generated) across sampled windows, 0–1. */
  score: number;
  /** Highest single-window P(AI) — flags a doc with some AI-looking sections. */
  peak: number;
  /** How many windows were scored. */
  chunks: number;
}

/** Progress for a long run so the UI can show a real loading phase: the model download
 *  (first use only) then per-window scoring (the slow part on a big essay). */
export type AiProgress =
  | { phase: "load"; pct: number }                 // model download, 0–100 (first run only)
  | { phase: "analyze"; done: number; total: number }; // window `done` of `total` being scored

/** Thrown when there isn't enough prose to produce a meaningful score. */
export class TooShortError extends Error {
  constructor() {
    super(`Need at least ${MIN_WORDS} words of text to estimate.`);
    this.name = "TooShortError";
  }
}

type Classify = (text: string, opts?: { top_k?: number | null }) => Promise<Array<{ label: string; score: number }>>;
let pipePromise: Promise<Classify> | null = null;

/** Lazily build (and cache) the text-classification pipeline. The dynamic import keeps
 *  transformers.js + onnxruntime-web out of the boot bundle (its own Rollup chunk).
 *  `onDownload` fires only while the ~34MB model is first being fetched (0–100); on every
 *  later call the cached pipeline resolves instantly and it never fires. */
async function getPipeline(onDownload?: (pct: number) => void): Promise<Classify> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await import("@huggingface/transformers");
      // Don't probe for a local model first (404-spams the console in the webview); go
      // straight to the hub, then it's cached for offline reuse.
      tf.env.allowLocalModels = false;
      const pipe = await tf.pipeline("text-classification", MODEL_ID, {
        dtype: "q8",
        // transformers.js emits {status, file, progress, loaded, total} per asset as it
        // downloads; surface the % for the model weights so the first run shows real progress.
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p?.status === "progress" && typeof p.progress === "number") onDownload?.(Math.round(p.progress));
        },
      });
      return ((text, opts) => pipe(text, opts) as Promise<Array<{ label: string; score: number }>>) as Classify;
    })();
  }
  return pipePromise;
}

/** Split prose into ~WORDS_PER_CHUNK windows, then evenly sample at most MAX_CHUNKS of them. */
export function chunkText(text: string): string[] {
  const words = stripFrontmatter(text).split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return [];
  const windows: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    windows.push(words.slice(i, i + WORDS_PER_CHUNK).join(" "));
  }
  if (windows.length <= MAX_CHUNKS) return windows;
  // Evenly sample across the document so the score reflects the whole essay, not just its head.
  const step = windows.length / MAX_CHUNKS;
  return Array.from({ length: MAX_CHUNKS }, (_, i) => windows[Math.floor(i * step)]);
}

/** P(AI) for one classifier result. LABEL_1 = AI / LABEL_0 = human (per the model card);
 *  fall back to name heuristics or inverting the human prob if labels were renamed. */
export function aiProb(results: Array<{ label: string; score: number }>): number {
  const ai = results.find((r) => /(^|_)1$/.test(r.label) || /\b(ai|fake|machine|generat|llm)/i.test(r.label));
  if (ai) return ai.score;
  const human = results.find((r) => /(^|_)0$/.test(r.label) || /human|real/i.test(r.label));
  if (human) return 1 - human.score;
  return results[0]?.score ?? 0;
}

/**
 * Estimate the probability that `text` is AI-generated, as a whole-document score.
 * Downloads the model on first call (cached after). Throws TooShortError for trivial input.
 * `onProgress` reports the download (first run) then each window as it's scored, so the
 * caller can show a real loading phase — a big essay is many windows, each a forward pass.
 */
export async function detectAiScore(text: string, onProgress?: (p: AiProgress) => void): Promise<AiDetectResult> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new TooShortError();
  const classify = await getPipeline((pct) => onProgress?.({ phase: "load", pct }));
  const probs: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ phase: "analyze", done: i + 1, total: chunks.length });
    const out = await classify(chunks[i], { top_k: 2 });
    probs.push(aiProb(out));
  }
  const score = probs.reduce((a, b) => a + b, 0) / probs.length;
  return { score, peak: Math.max(...probs), chunks: probs.length };
}
