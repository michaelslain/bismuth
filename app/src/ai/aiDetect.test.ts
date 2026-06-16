import { test, expect, describe } from "bun:test";
import { chunkText, aiProb } from "./aiDetect";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("chunkText", () => {
  test("trivial input yields no chunks (below the min-words floor)", () => {
    expect(chunkText("too short")).toEqual([]);
    expect(chunkText("")).toEqual([]);
  });

  test("strips YAML frontmatter before counting/scoring", () => {
    const fm = `---\ntags: [a, b]\ntitle: x\n---\n${words(60)}`;
    const chunks = chunkText(fm);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).not.toContain("tags:");
    expect(chunks[0]).not.toContain("title:");
  });

  test("splits long prose into multiple windows", () => {
    expect(chunkText(words(280)).length).toBe(1);
    expect(chunkText(words(281)).length).toBe(2);
    expect(chunkText(words(560)).length).toBe(2);
  });

  test("caps + evenly samples very long documents at 16 windows", () => {
    const chunks = chunkText(words(280 * 100)); // 100 windows worth
    expect(chunks.length).toBe(16);
  });
});

describe("aiProb (LABEL_1 = AI / LABEL_0 = human)", () => {
  test("reads the AI label directly", () => {
    expect(aiProb([{ label: "LABEL_1", score: 0.8 }, { label: "LABEL_0", score: 0.2 }])).toBeCloseTo(0.8);
  });
  test("order-independent", () => {
    expect(aiProb([{ label: "LABEL_0", score: 0.3 }, { label: "LABEL_1", score: 0.7 }])).toBeCloseTo(0.7);
  });
  test("inverts when only the human label is present", () => {
    expect(aiProb([{ label: "LABEL_0", score: 0.9 }])).toBeCloseTo(0.1);
  });
  test("handles human-readable label names", () => {
    expect(aiProb([{ label: "AI", score: 0.6 }, { label: "Human", score: 0.4 }])).toBeCloseTo(0.6);
    expect(aiProb([{ label: "human", score: 0.75 }, { label: "machine", score: 0.25 }])).toBeCloseTo(0.25);
  });
});
