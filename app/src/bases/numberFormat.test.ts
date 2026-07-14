import { describe, expect, test } from "bun:test";
import { formatNumberDisplay, numberEditValue, parseNumberEdit } from "./numberFormat";

describe("formatNumberDisplay", () => {
  test("plain (or no format) — value as-is", () => {
    expect(formatNumberDisplay(5, "plain", undefined)).toBe("5");
    expect(formatNumberDisplay(5, undefined, undefined)).toBe("5");
    expect(formatNumberDisplay(-2.5, "plain", undefined)).toBe("-2.5");
  });

  test("unit — value + unit label, bare value when no unit given", () => {
    expect(formatNumberDisplay(5, "unit", "kg")).toBe("5 kg");
    expect(formatNumberDisplay(5, "unit", undefined)).toBe("5");
    expect(formatNumberDisplay(5, "unit", "  ")).toBe("5");
  });

  test("currency — Intl currency format keyed by unit as an ISO code", () => {
    expect(formatNumberDisplay(5, "currency", "USD")).toBe("$5.00");
    expect(formatNumberDisplay(1234.5, "currency", "eur")).toMatch(/1,234.50/); // case-insensitive
  });

  test("currency — defaults to USD when no unit given", () => {
    expect(formatNumberDisplay(5, "currency", undefined)).toBe("$5.00");
  });

  test("currency — malformed code falls back to a plain suffix instead of throwing", () => {
    expect(formatNumberDisplay(5, "currency", "NOTACODE")).toBe("5 NOTACODE");
  });

  test("percent — stored as a 0-1 fraction, displayed ×100 with a % sign", () => {
    expect(formatNumberDisplay(0.25, "percent", undefined)).toBe("25%");
    expect(formatNumberDisplay(1, "percent", undefined)).toBe("100%");
    expect(formatNumberDisplay(0, "percent", undefined)).toBe("0%");
    expect(formatNumberDisplay(0.125, "percent", undefined)).toBe("12.5%");
  });
});

describe("numberEditValue / parseNumberEdit", () => {
  test("percent scales ×100 for editing, ÷100 back on commit", () => {
    expect(numberEditValue(0.25, "percent")).toBe(25);
    expect(parseNumberEdit("25", "percent")).toBe(0.25);
  });

  test("round-trips through the edit boundary", () => {
    for (const format of ["plain", "unit", "currency", "percent", undefined] as const) {
      const stored = 0.4;
      const edited = numberEditValue(stored, format);
      expect(parseNumberEdit(String(edited), format)).toBeCloseTo(stored, 10);
    }
  });

  test("non-percent formats pass the value straight through", () => {
    expect(numberEditValue(42, "plain")).toBe(42);
    expect(numberEditValue(42, "currency")).toBe(42);
    expect(parseNumberEdit("42", "unit")).toBe(42);
  });

  test("blank/unparseable input yields null", () => {
    expect(parseNumberEdit("", "plain")).toBeNull();
    expect(parseNumberEdit("   ", "percent")).toBeNull();
    expect(parseNumberEdit("abc", "plain")).toBeNull();
  });
});
