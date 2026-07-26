import { describe, it, expect } from "bun:test";
import { noiseField, DEFAULT_NOISE_SEED } from "./noiseField";

describe("noiseField", () => {
  it("emits exactly `rows` lines of exactly `cols` characters each", () => {
    const out = noiseField(12, 5);
    const lines = out.split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line.length).toBe(12);
  });

  it("density 0 is all spaces", () => {
    const out = noiseField(20, 4, 0);
    expect(out.replace(/\n/g, "")).toBe(" ".repeat(80));
  });

  it("density 1 has no spaces", () => {
    const out = noiseField(20, 4, 1);
    expect(out.includes(" ")).toBe(false);
  });

  it("is deterministic for a given seed", () => {
    const a = noiseField(30, 10, 0.34, 42);
    const b = noiseField(30, 10, 0.34, 42);
    expect(a).toBe(b);
  });

  it("differs across seeds", () => {
    const a = noiseField(30, 10, 0.34, 1);
    const b = noiseField(30, 10, 0.34, 2);
    expect(a).not.toBe(b);
  });

  it("uses the default seed when none is passed", () => {
    expect(noiseField(16, 6, 0.4)).toBe(noiseField(16, 6, 0.4, DEFAULT_NOISE_SEED));
  });

  it("only emits characters from the plain-ASCII glyph vocabulary", () => {
    const out = noiseField(60, 20, 0.6, 7).replace(/\n/g, "");
    expect(out).toMatch(/^[|\-+/\\`_#.o@ ]*$/);
  });

  it("handles a 0×0 field", () => {
    expect(noiseField(0, 0)).toBe("");
  });
});
