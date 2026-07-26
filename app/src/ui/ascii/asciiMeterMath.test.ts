import { describe, it, expect } from "bun:test";
import { chartFill, chartLabelPad, chartMax, meterFill } from "./asciiMeterMath";

describe("meterFill", () => {
  it("is empty at value 0", () => {
    expect(meterFill(0, 10)).toBe(0);
  });
  it("is full at value 1", () => {
    expect(meterFill(1, 10)).toBe(10);
  });
  it("rounds a mid value to the nearest cell", () => {
    expect(meterFill(0.5, 10)).toBe(5);
    expect(meterFill(0.55, 10)).toBe(6); // rounds up
  });
  it("clamps a negative value to 0", () => {
    expect(meterFill(-0.4, 10)).toBe(0);
  });
  it("clamps a value above 1 to the full width", () => {
    expect(meterFill(1.4, 10)).toBe(10);
  });
  it("handles a zero width", () => {
    expect(meterFill(0.5, 0)).toBe(0);
  });
  it("scales with an arbitrary width", () => {
    expect(meterFill(0.25, 20)).toBe(5);
    expect(meterFill(0.75, 4)).toBe(3);
  });
});

describe("chartMax", () => {
  it("bottoms out at 1 for an empty series", () => {
    expect(chartMax([])).toBe(1);
  });
  it("bottoms out at 1 when every value is smaller", () => {
    expect(chartMax([{ value: 0 }, { value: 0.4 }])).toBe(1);
  });
  it("picks the largest value", () => {
    expect(chartMax([{ value: 3 }, { value: 118 }, { value: 40 }])).toBe(118);
  });
});

describe("chartLabelPad", () => {
  it("is 0 for an empty series", () => {
    expect(chartLabelPad([])).toBe(0);
  });
  it("picks the longest label", () => {
    expect(chartLabelPad([{ label: "a" }, { label: "attention" }, { label: "bb" }])).toBe(9);
  });
});

describe("chartFill", () => {
  it("fills fully when value equals max", () => {
    expect(chartFill(10, 10, 16)).toBe(16);
  });
  it("is empty at value 0", () => {
    expect(chartFill(0, 10, 16)).toBe(0);
  });
  it("scales proportionally", () => {
    expect(chartFill(5, 10, 16)).toBe(8);
  });
  it("handles a zero width", () => {
    expect(chartFill(5, 10, 0)).toBe(0);
  });
  it("rounds like the reference implementation", () => {
    expect(chartFill(118, 118, 16)).toBe(16);
    expect(chartFill(3, 118, 16)).toBe(0); // rounds down from 0.4
  });
});
