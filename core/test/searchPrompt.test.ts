import { test, expect, describe } from "bun:test";
import {
  buildCandidateContext,
  buildPrompt,
  buildSnippet,
  parseModelOutput,
  validateResults,
  promptSearch,
  searchPromptDeps,
  type ModelResult,
} from "../src/searchPrompt";
import { makeVault } from "./helpers";
import { invalidateSearchIndex } from "../src/search";

// The whole AI prompt-search flow is validated WITHOUT spawning `claude`: the SDK boundary is behind
// searchPromptDeps.runModel and the CLI lookup behind searchPromptDeps.whichClaude, both overridable.

describe("buildCandidateContext (bounding)", () => {
  test("keeps FULL bodies for validation while truncating the model excerpt, and caps total size", () => {
    const cands = Array.from({ length: 40 }, (_, i) => ({ path: `n${i}.md`, body: "x".repeat(5000) }));
    const { context, bodiesByPath } = buildCandidateContext(cands);
    // At most 30 candidates (MAX_CANDIDATES) make it in.
    expect(bodiesByPath.size).toBeLessThanOrEqual(30);
    // Each block's excerpt is capped (~1.2K chars), so a 5000-char body never lands whole in context.
    expect(context.length).toBeLessThanOrEqual(36_000 + 2000);
    // The map carries the FULL body (not the excerpt) so verbatim validation can see the whole file.
    for (const body of bodiesByPath.values()) expect(body.length).toBe(5000);
  });

  test("always keeps at least one candidate even if it alone exceeds the cap", () => {
    const { bodiesByPath } = buildCandidateContext([{ path: "big.md", body: "y".repeat(100_000) }]);
    expect(bodiesByPath.has("big.md")).toBe(true);
  });

  test("dedupes repeated paths", () => {
    const { bodiesByPath } = buildCandidateContext([
      { path: "a.md", body: "first" },
      { path: "a.md", body: "second" },
    ]);
    expect(bodiesByPath.size).toBe(1);
    expect(bodiesByPath.get("a.md")).toBe("first");
  });

  test("buildPrompt embeds the question and the context", () => {
    const p = buildPrompt("the japan trip", "--- path: japan.md ---\nKyoto");
    expect(p).toContain("Question: the japan trip");
    expect(p).toContain("Kyoto");
  });
});

describe("buildSnippet (byte-exact + anti-hallucination)", () => {
  const body = "first line\nRadically different second line here\nthird line";

  test("accepts a quote present in a body and reconstructs the exact source line", () => {
    const snip = buildSnippet(body, "different second")!;
    expect(snip).not.toBeNull();
    expect(snip.line).toBe(2);
    const lines = body.split("\n");
    expect(snip.before + snip.match + snip.after).toBe(lines[snip.line - 1]);
    expect(snip.match).toBe("different second");
  });

  test("rejects a quote absent from the body (hallucinated/paraphrased)", () => {
    expect(buildSnippet(body, "this text never appears")).toBeNull();
  });

  test("case-insensitive fallback slices the REAL bytes (not the model's casing)", () => {
    const snip = buildSnippet(body, "RADICALLY DIFFERENT")!;
    expect(snip).not.toBeNull();
    expect(snip.match).toBe("Radically different"); // real body bytes, not the uppercased quote
    const lines = body.split("\n");
    expect(snip.before + snip.match + snip.after).toBe(lines[snip.line - 1]);
  });

  test("clamps a multi-line quote to its first line so the snippet stays single-line-exact", () => {
    const snip = buildSnippet(body, "second line here\nthird")!;
    expect(snip.line).toBe(2);
    const lines = body.split("\n");
    expect(snip.before + snip.match + snip.after).toBe(lines[snip.line - 1]);
  });

  test("empty quote is rejected", () => {
    expect(buildSnippet(body, "")).toBeNull();
  });
});

describe("validateResults (mapping + rejection)", () => {
  const bodies = new Map<string, string>([
    ["a.md", "alpha line\nsome unique phrase to quote\ntail"],
    ["b.md", "beta only"],
  ]);

  test("maps a valid path+quote to a byte-exact SearchResult carrying the reason", () => {
    const raw: ModelResult[] = [{ path: "a.md", quote: "unique phrase", reason: "because it matches" }];
    const out = validateResults(raw, bodies);
    expect(out.length).toBe(1);
    expect(out[0].path).toBe("a.md");
    expect(out[0].matchCount).toBe(1);
    expect(out[0].reason).toBe("because it matches");
    const line = bodies.get("a.md")!.split("\n")[out[0].snippets[0].line - 1];
    expect(out[0].snippets[0].before + out[0].snippets[0].match + out[0].snippets[0].after).toBe(line);
  });

  test("rejects a path not in the candidate set", () => {
    expect(validateResults([{ path: "ghost.md", quote: "alpha" }], bodies)).toEqual([]);
  });

  test("rejects a quote absent from the real body", () => {
    expect(validateResults([{ path: "a.md", quote: "not in the file at all" }], bodies)).toEqual([]);
  });

  test("preserves model order and keeps at most one result per path", () => {
    const raw: ModelResult[] = [
      { path: "b.md", quote: "beta" },
      { path: "a.md", quote: "alpha" },
      { path: "b.md", quote: "only" }, // duplicate path — dropped
    ];
    const out = validateResults(raw, bodies);
    expect(out.map((r) => r.path)).toEqual(["b.md", "a.md"]);
  });

  test("omits an empty/whitespace reason rather than carrying a blank caption", () => {
    const out = validateResults([{ path: "a.md", quote: "alpha", reason: "   " }], bodies);
    expect(out[0].reason).toBeUndefined();
  });
});

describe("parseModelOutput (structured + tolerant fallback)", () => {
  test("reads structured_output {results:[...]} first", () => {
    const out = parseModelOutput({ results: [{ path: "a.md", quote: "q", reason: "r" }] }, undefined);
    expect(out).toEqual([{ path: "a.md", quote: "q", reason: "r" }]);
  });

  test("accepts a bare array as structured output", () => {
    expect(parseModelOutput([{ path: "a.md", quote: "q" }], undefined)).toEqual([{ path: "a.md", quote: "q" }]);
  });

  test("falls back to tolerant JSON parse of the result text when structured is absent", () => {
    const text = 'Here you go:\n```json\n{"results":[{"path":"a.md","quote":"q"}]}\n```';
    expect(parseModelOutput(undefined, text)).toEqual([{ path: "a.md", quote: "q" }]);
  });

  test("extracts a first-brace..last-brace object from noisy text", () => {
    const text = 'blah {"results":[{"path":"z.md","quote":"hi"}]} trailing junk';
    expect(parseModelOutput(undefined, text)).toEqual([{ path: "z.md", quote: "hi" }]);
  });

  test("drops items missing path or quote; returns [] on garbage", () => {
    expect(parseModelOutput({ results: [{ path: "a.md" }, { quote: "q" }, 5] }, undefined)).toEqual([]);
    expect(parseModelOutput(undefined, "not json at all")).toEqual([]);
    expect(parseModelOutput(undefined, undefined)).toEqual([]);
  });
});

describe("promptSearch (end-to-end with stubbed deps)", () => {
  test("throws a 400 AppError when Claude Code isn't installed", async () => {
    const root = makeVault({ "a.md": "alpha" });
    const realWhich = searchPromptDeps.whichClaude;
    searchPromptDeps.whichClaude = () => null;
    try {
      await promptSearch(root, "anything");
      throw new Error("expected promptSearch to throw");
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(400);
      expect((e as Error).message).toContain("Claude Code installed");
    } finally {
      searchPromptDeps.whichClaude = realWhich;
      invalidateSearchIndex(root);
    }
  });

  test("ranks, runs the (stubbed) model, and returns validated byte-exact results", async () => {
    const root = makeVault({
      "japan.md": "# Japan trip\nWe visited Kyoto and stayed near Gion.",
      "other.md": "# Other\nunrelated content",
    });
    const realWhich = searchPromptDeps.whichClaude;
    const realRun = searchPromptDeps.runModel;
    searchPromptDeps.whichClaude = () => "/fake/claude";
    let sawContext = "";
    searchPromptDeps.runModel = async ({ context }) => {
      sawContext = context;
      return { structured: { results: [{ path: "japan.md", quote: "We visited Kyoto", reason: "trip note" }] }, resultText: undefined };
    };
    try {
      const results = await promptSearch(root, "where did I write about the japan trip");
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("japan.md");
      expect(results[0].snippets[0].match).toBe("We visited Kyoto");
      expect(results[0].reason).toBe("trip note");
      // The model only ever saw the bounded candidate context, never the raw vault.
      expect(sawContext).toContain("path: japan.md");
    } finally {
      searchPromptDeps.whichClaude = realWhich;
      searchPromptDeps.runModel = realRun;
      invalidateSearchIndex(root);
    }
  });

  test("returns [] (no model call) when there are no ranked candidates", async () => {
    const root = makeVault({ "a.md": "alpha content" });
    const realWhich = searchPromptDeps.whichClaude;
    const realRun = searchPromptDeps.runModel;
    let called = false;
    searchPromptDeps.whichClaude = () => "/fake/claude";
    searchPromptDeps.runModel = async () => { called = true; return { structured: { results: [] }, resultText: undefined }; };
    try {
      const results = await promptSearch(root, "zzzznonexistentterm");
      expect(results).toEqual([]);
      expect(called).toBe(false);
    } finally {
      searchPromptDeps.whichClaude = realWhich;
      searchPromptDeps.runModel = realRun;
      invalidateSearchIndex(root);
    }
  });
});
