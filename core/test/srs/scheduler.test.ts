import { test, expect } from "bun:test";
import {
  schedule,
  formatScheduling,
  parseScheduling,
  addDays,
} from "../../src/srs/scheduler";
import type { SchedulingInfo } from "../../src/srs/types";

const TODAY = "2026-05-27";

test("new card: good -> interval 1, ease 250", () => {
  const r = schedule(null, "good", TODAY);
  expect(r.interval).toBe(1);
  expect(r.ease).toBe(250);
  expect(r.due).toBe("2026-05-28");
});

test("new card: easy -> interval 4, ease 270", () => {
  const r = schedule(null, "easy", TODAY);
  expect(r.interval).toBe(4);
  expect(r.ease).toBe(270);
  expect(r.due).toBe("2026-05-31");
});

test("new card: hard -> interval 1, ease 250", () => {
  const r = schedule(null, "hard", TODAY);
  expect(r.interval).toBe(1);
  expect(r.ease).toBe(250);
});

test("reviewing good multiplies interval by ease/100", () => {
  const prev: SchedulingInfo = { due: TODAY, interval: 10, ease: 250 };
  const r = schedule(prev, "good", TODAY);
  expect(r.interval).toBe(25);
  expect(r.ease).toBe(250);
});

test("reviewing easy bumps ease and applies easyBonus", () => {
  const prev: SchedulingInfo = { due: TODAY, interval: 10, ease: 250 };
  const r = schedule(prev, "easy", TODAY);
  expect(r.ease).toBe(270);
  expect(r.interval).toBe(35);
});

test("reviewing hard halves interval and drops ease, floor 130", () => {
  const prev: SchedulingInfo = { due: TODAY, interval: 10, ease: 140 };
  const r = schedule(prev, "hard", TODAY);
  expect(r.ease).toBe(130);
  expect(r.interval).toBe(5);
});

test("hard never produces interval below 1", () => {
  const prev: SchedulingInfo = { due: TODAY, interval: 1, ease: 250 };
  const r = schedule(prev, "hard", TODAY);
  expect(r.interval).toBe(1);
});

test("formatScheduling renders one entry", () => {
  const s: SchedulingInfo[] = [{ due: "2026-06-01", interval: 4, ease: 270 }];
  expect(formatScheduling(s)).toBe("<!--SR:!2026-06-01,4,270-->");
});

test("formatScheduling renders multiple entries concatenated", () => {
  const s: SchedulingInfo[] = [
    { due: "2026-06-01", interval: 4, ease: 270 },
    { due: "2026-06-02", interval: 1, ease: 250 },
  ];
  expect(formatScheduling(s)).toBe("<!--SR:!2026-06-01,4,270!2026-06-02,1,250-->");
});

test("parseScheduling reads entries back", () => {
  const parsed = parseScheduling("<!--SR:!2026-06-01,4,270!2026-06-02,1,250-->");
  expect(parsed).toEqual([
    { due: "2026-06-01", interval: 4, ease: 270 },
    { due: "2026-06-02", interval: 1, ease: 250 },
  ]);
});

test("parseScheduling returns [] when no comment present", () => {
  expect(parseScheduling("just text")).toEqual([]);
});

test("addDays handles month rollover", () => {
  expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});

test("interval is clamped to MAX_INTERVAL", () => {
  const prev = { due: "2026-05-27", interval: 1_000_000, ease: 250 };
  const r = schedule(prev, "good", "2026-05-27");
  expect(r.interval).toBe(36525);
});
