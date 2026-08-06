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

// Change A: the "## "/"### "/…/"###### " markers before h2-h6 are opt-in (ExportOptions.
// showMarkdownSyntax), default off. wrapHtmlDocument's 7th positional param carries the flag.
// Asserting on the actual `content: "## "` declarations (not a proxy) so a bug that inverts the
// condition breaks ONE of the two tests below: default-off asserts absence, flag-on asserts
// presence — an inverted `showMarkdownSyntax ? "" : rule` would fail the second test instead.
describe("markdown-syntax markers (h2-h6 ::before, opt-in)", () => {
  test("default: no markdown-syntax marker CSS at all", () => {
    const out = wrapHtmlDocument("<h2>x</h2>", "N");
    expect(out).not.toContain('content: "## "');
    expect(out).not.toContain('content: "### "');
    expect(out).not.toContain('content: "#### "');
    expect(out).not.toContain('content: "##### "');
    expect(out).not.toContain('content: "###### "');
  });

  test("flag on: all five marker declarations are present", () => {
    // Positional: body, title, palette, extraHead, fontSizePt, page, showMarkdownSyntax.
    const out = wrapHtmlDocument("<h2>x</h2>", "N", undefined, "", undefined, undefined, true);
    expect(out).toContain('content: "## "');
    expect(out).toContain('content: "### "');
    expect(out).toContain('content: "#### "');
    expect(out).toContain('content: "##### "');
    expect(out).toContain('content: "###### "');
  });
});

// Change B (GitHub issue #9 follow-up): `pre` and `.callout` were the two blocks NOT pinned to
// the RULE_PX baseline grid, so a code block or callout could push everything below it off the
// grid pdfSliceMetrics snaps page breaks to. These are STRING assertions on the generated CSS —
// they prove the declared numbers are correct and grid-aligned, but bun test can't lay out a
// real DOM/canvas here, so this does NOT prove html2canvas's actual rendered box geometry lands
// on the grid end to end.
describe("pre / .callout stay on the RULE_PX baseline grid (GitHub issue #9 follow-up)", () => {
  test("pre: vertical margin and vertical padding are each a whole (nonzero) multiple of RULE_PX, in px", () => {
    const out = wrapHtmlDocument("<pre>x</pre>", "N");
    const preRule = /pre\s*\{[^}]*\}/.exec(out)?.[0] ?? "";
    const margin = /margin:\s*(\d+)px\s+0/.exec(preRule);
    const padding = /padding:\s*(\d+)px\s+1rem/.exec(preRule);
    expect(margin).not.toBeNull();
    expect(padding).not.toBeNull();
    const marginV = Number(margin![1]) * 2; // shorthand "Xpx 0" -> top + bottom
    const paddingV = Number(padding![1]) * 2;
    expect(marginV).toBeGreaterThan(0);
    expect(paddingV).toBeGreaterThan(0);
    expect(marginV % RULE_PX).toBe(0);
    expect(paddingV % RULE_PX).toBe(0);
  });

  test("pre keeps background/border-radius/overflow/white-space/word-break/line-height untouched", () => {
    const out = wrapHtmlDocument("<pre>x</pre>", "N");
    const preRule = /pre\s*\{[^}]*\}/.exec(out)?.[0] ?? "";
    expect(preRule).toContain("border-radius: 6px");
    expect(preRule).toContain("overflow: auto");
    expect(preRule).toContain("white-space: pre-wrap");
    expect(preRule).toContain("word-break: break-word");
    expect(preRule).toMatch(new RegExp(`line-height:\\s*${RULE_PX}px`));
  });

  test(".callout: border-top + padding-top + padding-bottom + border-bottom + callout-content's margin-top sum to a whole (nonzero) multiple of RULE_PX, in px", () => {
    const out = wrapHtmlDocument("<p>x</p>", "N");
    const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? "";
    const contentRule = /\.callout-content\s*\{[^}]*\}/.exec(out)?.[0] ?? "";
    const border = /border:\s*(\d+)px/.exec(calloutRule);
    const padding = /padding:\s*(\d+)px\s+[\d.]+em/.exec(calloutRule);
    const gap = /margin-top:\s*(\d+)px/.exec(contentRule);
    expect(border).not.toBeNull();
    expect(padding).not.toBeNull();
    expect(gap).not.toBeNull();
    const borderPx = Number(border![1]);
    const paddingPx = Number(padding![1]);
    const gapPx = Number(gap![1]);
    const total = borderPx + paddingPx + paddingPx + borderPx + gapPx;
    expect(total).toBeGreaterThan(0);
    expect(total % RULE_PX).toBe(0);
  });

  test(".callout: vertical values are px (not em), so the grid math is IDENTICAL at every PDF_FONT_SIZES entry", () => {
    // fontSizePt only affects em-relative descendant sizing (the PDF path's body font size);
    // pre/.callout's vertical rhythm must not move at all when it changes — proving the fix
    // doesn't merely work at the default 12pt by coincidence, the exact shape of the original bug.
    const sizes = [9, 10, 11, 12, 14, 16, 18]; // PDF_FONT_SIZES (app/src/export/options.ts)
    const calloutRules = sizes.map((pt) => {
      const out = wrapHtmlDocument("<p>x</p>", "N", undefined, "", pt);
      return /\.callout\s*\{[^}]*\}/.exec(out)?.[0];
    });
    const preRules = sizes.map((pt) => {
      const out = wrapHtmlDocument("<pre>x</pre>", "N", undefined, "", pt);
      return /pre\s*\{[^}]*\}/.exec(out)?.[0];
    });
    expect(new Set(calloutRules).size).toBe(1); // byte-identical .callout rule at every size
    expect(new Set(preRules).size).toBe(1); // byte-identical pre rule at every size
    // Not em/em, which was the original bug shape (padding: 0.55em 0.85em).
    expect(calloutRules[0]).not.toMatch(/padding:\s*[\d.]+em\s+[\d.]+em/);
  });

  test("pre and .callout keep their other deliberate design untouched (border-radius, border-left-width, background, horizontal padding)", () => {
    const out = wrapHtmlDocument("<p>x</p>", "N");
    const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? "";
    expect(calloutRule).toContain("border-left-width: 4px");
    expect(calloutRule).toContain("border-radius: 6px");
    expect(calloutRule).toContain("0.85em"); // horizontal padding unchanged
    expect(calloutRule).toContain("rgba(127,127,127,0.06)"); // background unchanged
  });
});
