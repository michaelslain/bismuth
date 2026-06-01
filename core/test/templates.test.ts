import { test, expect } from "bun:test";
import { expandTemplate } from "../src/templates";

// Fixed clock: local Sunday May 31 2026, 14:09:05
// new Date(year, monthIndex, day, hours, minutes, seconds)
// month 4 = May (0-based)
const now = new Date(2026, 4, 31, 14, 9, 5);
const ctx = { now, title: "My Note" };

// ---------- default date/time ----------

test("{{date}} expands to YYYY-MM-DD", () => {
  const { text, cursorOffset } = expandTemplate("{{date}}", ctx);
  expect(text).toBe("2026-05-31");
  expect(cursorOffset).toBe(text.length);
});

test("{{time}} expands to HH:mm", () => {
  const { text, cursorOffset } = expandTemplate("{{time}}", ctx);
  expect(text).toBe("14:09");
  expect(cursorOffset).toBe(text.length);
});

// ---------- custom formats ----------

test("{{date:YYYY/MM/DD}} uses slash separators", () => {
  const { text } = expandTemplate("{{date:YYYY/MM/DD}}", ctx);
  expect(text).toBe("2026/05/31");
});

test("{{date:dddd, MMMM D}} emits full weekday and full month", () => {
  const { text } = expandTemplate("{{date:dddd, MMMM D}}", ctx);
  expect(text).toBe("Sunday, May 31");
});

test("{{time:h:mm A}} produces 12-hour time with AM/PM", () => {
  const { text } = expandTemplate("{{time:h:mm A}}", ctx);
  expect(text).toBe("2:09 PM");
});

test("{{time:HH:mm:ss}} produces zero-padded 24-hour time with seconds", () => {
  const { text } = expandTemplate("{{time:HH:mm:ss}}", ctx);
  expect(text).toBe("14:09:05");
});

// ---------- longest-match precedence ----------

test("{{date:MMMM}} emits full month name May", () => {
  const { text } = expandTemplate("{{date:MMMM}}", ctx);
  expect(text).toBe("May");
});

test("{{date:MM}} emits 2-digit month 05", () => {
  const { text } = expandTemplate("{{date:MM}}", ctx);
  expect(text).toBe("05");
});

// ---------- date offsets ----------

test("{{date+7d}} adds 7 days → 2026-06-07", () => {
  const { text } = expandTemplate("{{date+7d}}", ctx);
  expect(text).toBe("2026-06-07");
});

test("{{date-1w}} subtracts 1 week → 2026-05-24", () => {
  const { text } = expandTemplate("{{date-1w}}", ctx);
  expect(text).toBe("2026-05-24");
});

test("{{date+1y}} adds 1 year → 2027-05-31", () => {
  const { text } = expandTemplate("{{date+1y}}", ctx);
  expect(text).toBe("2027-05-31");
});

// +1 month from 2026-05-31 using JS setMonth(getMonth()+1):
// setMonth(5) on a Date where the day is 31 → June has 30 days, JS rolls over to July 1.
// So the result is 2026-07-01. This is natural JS setMonth rollover behaviour.
test("{{date+1m}} month rollover — JS setMonth(5+1) on day-31 rolls into July", () => {
  const { text } = expandTemplate("{{date+1m}}", ctx);
  // May 31 + 1 month: June has 30 days, day 31 doesn't exist → JS rolls to 2026-07-01
  expect(text).toBe("2026-07-01");
});

// ---------- time offsets ----------

test("{{time+2h}} adds 2 hours → 16:09", () => {
  const { text } = expandTemplate("{{time+2h}}", ctx);
  expect(text).toBe("16:09");
});

test("{{time-30m}} subtracts 30 minutes → 13:39", () => {
  const { text } = expandTemplate("{{time-30m}}", ctx);
  expect(text).toBe("13:39");
});

// ---------- offset + custom format ----------

test("{{date+1w:YYYY-MM-DD}} offset and format together → 2026-06-07", () => {
  const { text } = expandTemplate("{{date+1w:YYYY-MM-DD}}", ctx);
  expect(text).toBe("2026-06-07");
});

// ---------- {{title}} ----------

test("{{title}} expands to ctx.title verbatim", () => {
  const { text } = expandTemplate("{{title}}", ctx);
  expect(text).toBe("My Note");
});

test("{{title}} embedded in surrounding text", () => {
  const { text } = expandTemplate("Note: {{title}} created on {{date}}", ctx);
  expect(text).toBe("Note: My Note created on 2026-05-31");
});

// ---------- {{cursor}} ----------

test("{{cursor}} expands to empty string, offset recorded", () => {
  const { text, cursorOffset } = expandTemplate("a{{cursor}}b", ctx);
  expect(text).toBe("ab");
  expect(cursorOffset).toBe(1);
});

test("no {{cursor}} → cursorOffset equals text.length", () => {
  const { text, cursorOffset } = expandTemplate("hello", ctx);
  expect(cursorOffset).toBe(text.length);
  expect(cursorOffset).toBe(5);
});

test("multiple {{cursor}} → first wins, rest stripped", () => {
  const { text, cursorOffset } = expandTemplate("{{cursor}}x{{cursor}}y", ctx);
  expect(text).toBe("xy");
  expect(cursorOffset).toBe(0);
});

test("{{cursor}} at end of string → offset equals text.length", () => {
  const { text, cursorOffset } = expandTemplate("end{{cursor}}", ctx);
  expect(text).toBe("end");
  expect(cursorOffset).toBe(3);
});

// ---------- unknown / malformed tokens ----------

test("unknown token {{foo}} is left verbatim", () => {
  const { text } = expandTemplate("{{foo}}", ctx);
  expect(text).toBe("{{foo}}");
});

test("malformed format {{date:}} (empty format string) is left verbatim", () => {
  const { text } = expandTemplate("{{date:}}", ctx);
  expect(text).toBe("{{date:}}");
});

test("unknown token mixed with valid token", () => {
  const { text } = expandTemplate("{{foo}} and {{date}}", ctx);
  expect(text).toBe("{{foo}} and 2026-05-31");
});

// ---------- edge cases ----------

test("empty string → text empty, cursorOffset 0", () => {
  const { text, cursorOffset } = expandTemplate("", ctx);
  expect(text).toBe("");
  expect(cursorOffset).toBe(0);
});

test("no tokens → text unchanged, cursorOffset equals length", () => {
  const { text, cursorOffset } = expandTemplate("plain text", ctx);
  expect(text).toBe("plain text");
  expect(cursorOffset).toBe(10);
});

test("multiple valid tokens in one template", () => {
  const { text } = expandTemplate("# {{title}}\nCreated: {{date}}\nTime: {{time}}", ctx);
  expect(text).toBe("# My Note\nCreated: 2026-05-31\nTime: 14:09");
});
