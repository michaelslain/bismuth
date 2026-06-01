// app/src/themeColors.test.ts
import { describe, test, expect } from "bun:test";
import {
  hexToInt,
  intToHex,
  hashKey,
  paletteIndex,
  paletteColorInt,
  paletteColorHex,
  paletteToInts,
} from "./themeColors";

const OXIDE = ["#F0509B", "#9B53E8", "#3F6BF0", "#27C7D9", "#43D49A", "#F2C53D"];

describe("hexToInt", () => {
  test("parses #rrggbb and bare rrggbb", () => {
    expect(hexToInt("#3F6BF0")).toBe(0x3f6bf0);
    expect(hexToInt("3f6bf0")).toBe(0x3f6bf0);
    expect(hexToInt("  #14151B  ")).toBe(0x14151b);
  });
  test("falls back on garbage", () => {
    expect(hexToInt("nope", 0x123456)).toBe(0x123456);
    expect(hexToInt("#fff", 0x111111)).toBe(0x111111); // 3-digit not accepted
    expect(hexToInt("", 0xabcdef)).toBe(0xabcdef);
  });
});

describe("intToHex", () => {
  test("zero-pads and lowercases", () => {
    expect(intToHex(0x3f6bf0)).toBe("#3f6bf0");
    expect(intToHex(0x000001)).toBe("#000001");
  });
  test("round-trips with hexToInt", () => {
    for (const h of OXIDE) expect(intToHex(hexToInt(h))).toBe(h.toLowerCase());
  });
});

describe("hashKey + paletteIndex", () => {
  test("deterministic for the same key", () => {
    expect(hashKey("folder:reading")).toBe(hashKey("folder:reading"));
    expect(paletteIndex("tag:book", 6)).toBe(paletteIndex("tag:book", 6));
  });
  test("index stays in range", () => {
    for (const k of ["a", "folder:x", "community:3", "tag:zzz", "agent:bot"]) {
      const i = paletteIndex(k, OXIDE.length);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(OXIDE.length);
    }
  });
  test("empty palette is safe", () => {
    expect(paletteIndex("x", 0)).toBe(0);
  });
});

describe("paletteColor", () => {
  test("int + hex agree for the same key and palette", () => {
    const ints = paletteToInts(OXIDE);
    for (const k of ["folder:reading", "tag:book", "community:1"]) {
      const hex = paletteColorHex(k, OXIDE);
      const i = paletteColorInt(k, ints);
      expect(intToHex(i)).toBe(hex.toLowerCase());
    }
  });
  test("empty palettes return black sentinels", () => {
    expect(paletteColorInt("x", [])).toBe(0x000000);
    expect(paletteColorHex("x", [])).toBe("#000000");
  });
});

describe("paletteToInts", () => {
  test("converts the Oxide palette", () => {
    expect(paletteToInts(OXIDE)).toEqual([
      0xf0509b, 0x9b53e8, 0x3f6bf0, 0x27c7d9, 0x43d49a, 0xf2c53d,
    ]);
  });
  test("malformed entries fall back to grey", () => {
    expect(paletteToInts(["bad", "#43D49A"])).toEqual([0x808080, 0x43d49a]);
  });
});
