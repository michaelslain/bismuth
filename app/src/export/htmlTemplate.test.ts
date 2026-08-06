// app/src/export/htmlTemplate.test.ts
import { test, expect, describe } from "bun:test";
import { wrapHtmlDocument, RULE_PX } from "./htmlTemplate";

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

  test("omits an explicit body font-size when none is requested (intrinsic sizing)", () => {
    // Narrowed to the PDF-only conditional rule specifically (pt units) — the stylesheet
    // legitimately carries other unconditional font-size rules (.fmatter, .pagefoot) that
    // have nothing to do with fontSizePt, so a blanket "no font-size anywhere" assertion
    // would be testing the wrong thing.
    const out = wrapHtmlDocument("<p>hi</p>", "N");
    expect(out).not.toMatch(/font-size:\s*\d+pt/);
  });

  test("emits the requested body font-size (pt) when given", () => {
    expect(wrapHtmlDocument("<p>hi</p>", "N", undefined, "", 12)).toContain("font-size: 12pt");
    expect(wrapHtmlDocument("<p>hi</p>", "N", undefined, "", 18)).toContain("font-size: 18pt");
  });

  // GitHub issue #9, defect 2: a horizontal ruled-paper background painted a line under every
  // row of text in every export. The repo owner first asked to scope removal to the PDF path
  // only, then broadened it mid-task ("lets not just scope it to pdf but all formats!") — so
  // there is no format-conditional here, just an unconditional absence of the background.
  test("no export document ever carries the ruled-paper background (removed for every format)", () => {
    const out = wrapHtmlDocument("<p>hi</p>", "N");
    expect(out).not.toContain("linear-gradient");
    expect(out).not.toMatch(/background-size:\s*100%\s*\d+px/);
  });

  // The 22px text-baseline grid is a SEPARATE thing from the visible rules and must survive
  // their removal — defect 1's page-slicing fix (pageGeometry.ts pdfSliceMetrics) snaps page
  // height to whole multiples of this exact grid, so it staying intact is load-bearing, not
  // cosmetic.
  test("the 22px line-height baseline grid survives the ruled-background removal", () => {
    const out = wrapHtmlDocument("<p>hi</p>", "N");
    expect(out).toContain(`line-height: ${RULE_PX}px`);
  });
});
