import { test, expect, describe } from "bun:test";
import {
  buildCandidateContext,
  buildPrompt,
  buildSnippet,
  bestSnippet,
  parseModelOutput,
  validateResults,
  promptSearch,
  searchPromptDeps,
  consumeModelStream,
  type ModelResult,
} from "../src/searchPrompt";
import { makeVault } from "./helpers";
import { invalidateSearchIndex } from "../src/search";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AppError } from "../src/error";

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

  // BUG #8 root cause: notes are hard-wrapped, so the model reflows the wrapped newlines into
  // spaces in its quote. Neither exact nor case-insensitive indexOf finds it even though every word
  // is present in order — which silently rejected ~every AI result. The whitespace-normalized
  // fallback must locate it and still slice a byte-exact single-line snippet from the real body.
  test("locates a quote whose hard-wrapped newlines the model reflowed into spaces", () => {
    const wrapped = "We spent two weeks travelling through Japan in the\nspring. Kyoto was the highlight of the trip.";
    const reflowed = "travelling through Japan in the spring. Kyoto was the highlight"; // newline → space
    expect(wrapped.indexOf(reflowed)).toBe(-1); // exact indexOf genuinely misses (the old gate)
    const snip = buildSnippet(wrapped, reflowed)!;
    expect(snip).not.toBeNull();
    expect(snip.line).toBe(1); // clamped to the first line of the span
    const lines = wrapped.split("\n");
    expect(snip.before + snip.match + snip.after).toBe(lines[snip.line - 1]);
    expect(snip.match).toContain("travelling through Japan in the"); // real body bytes on line 1
  });

  test("normalized fallback collapses runs of spaces/tabs too, not just newlines", () => {
    const spaced = "the   grind\tsize matters more than the beans";
    const snip = buildSnippet(spaced, "grind size matters")!;
    expect(snip).not.toBeNull();
    expect(snip.match).toContain("grind");
  });
});

describe("bestSnippet (located → keyword → preview fallback tiers)", () => {
  const body = "# Coffee notes\n\nThe grind size matters more than the beans for a bright clean cup.";

  test("tier 1: returns the located quote when present", () => {
    const s = bestSnippet(body, "grind size matters")!;
    expect(s.match).toBe("grind size matters");
  });

  test("tier 2: derives a snippet from a quote keyword when the quote isn't locatable verbatim", () => {
    // The quote paraphrases, but shares the content word "beans" with the body.
    const s = bestSnippet(body, "notes on choosing good beans and roast level")!;
    expect(s.match).toBe("beans");
  });

  test("tier 2: falls through to a question keyword when no quote keyword matches", () => {
    const s = bestSnippet(body, "utterly unrelated wording xyzzy", "how do I pick a grind")!;
    expect(s.match).toBe("grind");
  });

  test("tier 3: first-line preview when nothing matches at all", () => {
    const s = bestSnippet(body, "xyzzy plugh", "foobar")!;
    expect(s.match).toBe(""); // un-highlighted preview
    expect(s.after).toBe("# Coffee notes");
  });

  test("returns null only for an empty/all-blank body", () => {
    expect(bestSnippet("", "anything")).toBeNull();
    expect(bestSnippet("   \n\t\n", "anything")).toBeNull();
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

  test("still hard-rejects a path not in the candidate set (the security boundary)", () => {
    expect(validateResults([{ path: "ghost.md", quote: "alpha" }], bodies)).toEqual([]);
  });

  // BUG #8: the loosened validation. A reflowed / paraphrased quote must NO LONGER drop a correctly
  // chosen candidate — instead we surface it with a snippet sliced byte-for-byte from the real body.
  test("a reflowed (newline→space) quote now SURVIVES with a byte-exact body snippet", () => {
    // The model joined a.md's wrapped lines with a space; exact/CI indexOf miss it.
    const quote = "some unique phrase to quote tail";
    expect(bodies.get("a.md")!.indexOf(quote)).toBe(-1);
    const out = validateResults([{ path: "a.md", quote }], bodies);
    expect(out.length).toBe(1);
    expect(out[0].path).toBe("a.md");
    const s = out[0].snippets[0];
    const line = bodies.get("a.md")!.split("\n")[s.line - 1];
    expect(s.before + s.match + s.after).toBe(line); // real body line, not model text
  });

  test("a fully paraphrased quote still surfaces the candidate via a question-keyword snippet", () => {
    // None of the paraphrase words are in the body, but the question keyword "phrase" is — anchor
    // there rather than dropping a note the model correctly picked.
    const out = validateResults(
      [{ path: "a.md", quote: "a completely reworded summary" }],
      bodies,
      "where is the unique phrase",
    );
    expect(out.length).toBe(1);
    const s = out[0].snippets[0];
    expect(s.match.length).toBeGreaterThan(0);
    expect(bodies.get("a.md")!).toContain(s.match); // sliced from the real body
  });

  test("an unlocatable quote with no keyword match still surfaces the note (first-line preview)", () => {
    const out = validateResults([{ path: "b.md", quote: "qqqqqq wwwwww eeeeee" }], bodies);
    expect(out.length).toBe(1);
    expect(out[0].path).toBe("b.md");
    const s = out[0].snippets[0];
    expect(s.before + s.match + s.after).toBe("beta only"); // whole first line, un-highlighted
  });

  test("skips a candidate with a truly empty body (nothing to show)", () => {
    const withEmpty = new Map(bodies);
    withEmpty.set("empty.md", "");
    expect(validateResults([{ path: "empty.md", quote: "anything" }], withEmpty)).toEqual([]);
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

// BUG #8, 3rd bounce: the reopened "AI search literally does nothing" report. `consumeModelStream`
// is the exact seam that used to swallow a broken `claude` process (not logged in, killed, crashed,
// unexpected output) into a silent empty result — indistinguishable in the UI from "the AI ran and
// found nothing". These tests exercise it directly with synthetic SDK message streams, no `claude`
// process or module mocking required.
describe("consumeModelStream (anomaly handling — BUG #8 3rd-bounce root cause)", () => {
  async function* streamOf(msgs: Partial<SDKMessage>[]): AsyncGenerator<SDKMessage> {
    for (const m of msgs) yield m as SDKMessage;
  }

  test("returns the structured payload on a success result message", async () => {
    const out = await consumeModelStream(
      streamOf([
        { type: "system", subtype: "init" } as Partial<SDKMessage>,
        { type: "result", subtype: "success", structured_output: { results: [] }, result: "ok" } as unknown as Partial<SDKMessage>,
      ]),
    );
    expect(out.structured).toEqual({ results: [] });
    expect(out.resultText).toBe("ok");
  });

  test("throws a 500 AppError for a non-success result subtype", async () => {
    const p = consumeModelStream(streamOf([{ type: "result", subtype: "error_max_turns" } as unknown as Partial<SDKMessage>]));
    await expect(p).rejects.toThrow();
    try {
      await consumeModelStream(streamOf([{ type: "result", subtype: "error_max_turns" } as unknown as Partial<SDKMessage>]));
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(500);
      expect((e as Error).message).toContain("error_max_turns");
    }
  });

  test("THE FIX: throws instead of silently succeeding when the stream ends with no result message at all (early `claude` exit — e.g. not logged in, killed, crashed)", async () => {
    // Only an init message, then the stream just ends — no "result" ever arrives. Before the fix,
    // this fell through to `{ structured: undefined, resultText: undefined }`, which promptSearch
    // silently turned into `[]` — rendered as "Bismuth AI found nothing relevant", identical to a
    // genuinely empty (but successful) search.
    const p = consumeModelStream(streamOf([{ type: "system", subtype: "init" } as Partial<SDKMessage>]));
    await expect(p).rejects.toThrow();
    try {
      await consumeModelStream(streamOf([{ type: "system", subtype: "init" } as Partial<SDKMessage>]));
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(500);
      expect((e as Error).message).toContain("Claude Code");
    }
  });

  test("THE FIX: throws for a completely empty stream (zero messages — immediate process exit)", async () => {
    const p = consumeModelStream(streamOf([]));
    await expect(p).rejects.toThrow();
  });

  // BUG #8, 4th bounce: reproduced live by spawning the real `claude` binary with $USER/$LOGNAME
  // unset (a Finder-launched sidecar's actual env) — it reports "Not logged in · Please run
  // /login" as `type: "result", subtype: "success", is_error: true`, NOT a non-success subtype and
  // NOT an early stream end. The 3rd-bounce fix above only branched on `subtype`, so this exact
  // shape sailed straight through to `{ structured: undefined, resultText: "Not logged in…" }` —
  // unparseable as JSON, silently coerced to `[]` downstream. Indistinguishable from a real empty
  // answer. This must now be a diagnosable error, not a silent empty result.
  test("THE FIX (4th bounce): throws when a 'success' result message carries is_error: true", async () => {
    const p = consumeModelStream(
      streamOf([
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "Not logged in · Please run /login",
        } as unknown as Partial<SDKMessage>,
      ]),
    );
    await expect(p).rejects.toThrow();
    try {
      await consumeModelStream(
        streamOf([
          { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" } as unknown as Partial<SDKMessage>,
        ]),
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(500);
      expect((e as Error).message).toContain("Not logged in");
    }
  });

  test("a 'success' result with is_error: false (the normal case) still returns its payload", async () => {
    const out = await consumeModelStream(
      streamOf([
        { type: "result", subtype: "success", is_error: false, structured_output: { results: [] }, result: "ok" } as unknown as Partial<SDKMessage>,
      ]),
    );
    expect(out.structured).toEqual({ results: [] });
  });

  test("promptSearch propagates consumeModelStream's error as a 500 the UI can render (not a silent [])", async () => {
    const root = makeVault({ "a.md": "some content to rank as a candidate" });
    const realWhich = searchPromptDeps.whichClaude;
    const realRun = searchPromptDeps.runModel;
    searchPromptDeps.whichClaude = () => "/fake/claude";
    // Simulate runModelReal's real behavior end-to-end: the stream ends with no result message.
    searchPromptDeps.runModel = () => consumeModelStream(streamOf([{ type: "system", subtype: "init" } as Partial<SDKMessage>]));
    try {
      await promptSearch(root, "where is the content");
      throw new Error("expected promptSearch to throw, not return silently");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).statusCode).toBe(500);
    } finally {
      searchPromptDeps.whichClaude = realWhich;
      searchPromptDeps.runModel = realRun;
      invalidateSearchIndex(root);
    }
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

  test("BUG #8: a reflowed multi-line quote from the model survives end-to-end", async () => {
    const bodyText = "# Deep work\nProtecting a few hours of uninterrupted\ndeep work every day is the one thing that matters.";
    const root = makeVault({ "wrapped.md": bodyText });
    const realWhich = searchPromptDeps.whichClaude;
    const realRun = searchPromptDeps.runModel;
    searchPromptDeps.whichClaude = () => "/fake/claude";
    // The model reflows the note's hard-wrapped newline into a space — the exact real-world failure
    // that used to make validateResults drop every result and show the user an empty AI search.
    searchPromptDeps.runModel = async () => ({
      structured: { results: [{ path: "wrapped.md", quote: "uninterrupted deep work every day", reason: "answers it" }] },
      resultText: undefined,
    });
    try {
      const results = await promptSearch(root, "how do I do focused work");
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("wrapped.md");
      const s = results[0].snippets[0];
      expect(bodyText.split("\n")[s.line - 1]).toBe(s.before + s.match + s.after); // real body bytes
      expect(s.match.length).toBeGreaterThan(0);
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

// ── #8 (5th bounce): a hung claude must become a visible timeout, never an endless wait ──
import { raceWithTimeout } from "../src/searchPrompt";

describe("raceWithTimeout", () => {
  test("a never-resolving stream becomes a clear timeout error and aborts the controller", async () => {
    const abort = new AbortController();
    // Simulate consumeModelStream over a stream that dies when aborted (like the SDK's).
    const work = new Promise((_res, rej) => {
      abort.signal.addEventListener("abort", () => rej(new Error("stream torn down")), { once: true });
    });
    await expect(raceWithTimeout(work, abort, 30)).rejects.toThrow(/timed out after/);
    expect(abort.signal.aborted).toBe(true);
  });

  test("a fast result passes through untouched", async () => {
    const abort = new AbortController();
    await expect(raceWithTimeout(Promise.resolve("ok"), abort, 5000)).resolves.toBe("ok");
    expect(abort.signal.aborted).toBe(false);
  });

  test("a caller-initiated abort keeps the ORIGINAL error (not remapped to timeout)", async () => {
    const external = new AbortController();
    const abort = new AbortController();
    const work = new Promise((_res, rej) => {
      abort.signal.addEventListener("abort", () => rej(new Error("caller cancelled")), { once: true });
    });
    const p = raceWithTimeout(work, abort, 10_000, external.signal);
    external.abort();
    abort.abort(); // runModelReal wires external → abort; simulate that linkage
    await expect(p).rejects.toThrow("caller cancelled");
  });

  test("work errors pass through unchanged when no timeout fired", async () => {
    const abort = new AbortController();
    await expect(raceWithTimeout(Promise.reject(new Error("real failure")), abort, 5000)).rejects.toThrow("real failure");
  });
});

// ── #8 (5th bounce): a hung claude must become a visible timeout, never an endless wait ──
import { raceWithTimeout } from "../src/searchPrompt";

describe("raceWithTimeout", () => {
  test("a never-resolving stream becomes a clear timeout error and aborts the controller", async () => {
    const abort = new AbortController();
    // Simulate consumeModelStream over a stream that dies when aborted (like the SDK's).
    const work = new Promise((_res, rej) => {
      abort.signal.addEventListener("abort", () => rej(new Error("stream torn down")), { once: true });
    });
    await expect(raceWithTimeout(work, abort, 30)).rejects.toThrow(/timed out after/);
    expect(abort.signal.aborted).toBe(true);
  });

  test("a fast result passes through untouched", async () => {
    const abort = new AbortController();
    await expect(raceWithTimeout(Promise.resolve("ok"), abort, 5000)).resolves.toBe("ok");
    expect(abort.signal.aborted).toBe(false);
  });

  test("a caller-initiated abort keeps the ORIGINAL error (not remapped to timeout)", async () => {
    const external = new AbortController();
    const abort = new AbortController();
    const work = new Promise((_res, rej) => {
      abort.signal.addEventListener("abort", () => rej(new Error("caller cancelled")), { once: true });
    });
    const p = raceWithTimeout(work, abort, 10_000, external.signal);
    external.abort();
    abort.abort(); // runModelReal wires external → abort; simulate that linkage
    await expect(p).rejects.toThrow("caller cancelled");
  });

  test("work errors pass through unchanged when no timeout fired", async () => {
    const abort = new AbortController();
    await expect(raceWithTimeout(Promise.reject(new Error("real failure")), abort, 5000)).rejects.toThrow("real failure");
  });
});
