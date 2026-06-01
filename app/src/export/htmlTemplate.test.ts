// app/src/export/htmlTemplate.test.ts
import { test, expect, describe } from "bun:test";
import { wrapHtmlDocument } from "./htmlTemplate";

describe("wrapHtmlDocument", () => {
  test("produces a full html doc with the body inlined", () => {
    const out = wrapHtmlDocument("<p>hi</p>", "My Note");
    expect(out).toContain("<!doctype html>");
    expect(out).toContain("<title>My Note</title>");
    expect(out).toContain("<p>hi</p>");
    expect(out).toContain("<style>");
  });
  test("escapes the title", () => {
    const out = wrapHtmlDocument("", `A & B <x>`);
    expect(out).toContain("<title>A &amp; B &lt;x&gt;</title>");
    expect(out).not.toContain("<title>A & B <x></title>");
  });
});
