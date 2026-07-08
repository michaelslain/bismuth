// Pins the native-drop coordinate transform + the single-claim guard (#30 re-bounce).
import { test, expect, describe } from "bun:test";
import { nativeDropScale, claimNativeDrop } from "./nativeDropRouting";

// The transform: nativeDrop.ts forwards physical/devicePixelRatio. nativeDropScale is the
// residual factor that turns that into true page CSS px, measured end-to-end from the
// window's physical inner width vs the CSS viewport width. The three worlds it must pin:
describe("#30 nativeDropScale — the physical→CSS correction", () => {
  test("no zoom (any DPR): forwarded coords are already CSS px → factor 1", () => {
    // Retina: 1200 CSS px viewport, 2400 physical, dpr 2. phys/dpr = css already.
    expect(nativeDropScale(2, 1200, 2400)).toBe(1);
    // Non-HiDPI: dpr 1, css == phys.
    expect(nativeDropScale(1, 1200, 1200)).toBe(1);
  });

  test("Chromium-style zoom (folded into DPR): still a no-op", () => {
    // 125% zoom on a 2x display: dpr = 2.5, window points 600 → css 480, phys 1200.
    // phys/dpr = 1200/2.5 = 480 = css — the bridge division was already right.
    expect(nativeDropScale(2.5, 480, 1200)).toBe(1);
  });

  test("WebKit page zoom (NOT folded into DPR): factor = 1/zoom — the wrong-cell fix", () => {
    // The packaged Tauri WKWebView at 125%: dpr stays 2, window points 600 → css 480,
    // phys 1200. The bridge forwards phys/2 = points (600-space), but the page's CSS
    // space is 480 — every coordinate is 25% too large. factor = 2*480/1200 = 0.8 = 1/1.25.
    expect(nativeDropScale(2, 480, 1200)).toBeCloseTo(1 / 1.25, 10);
    // Zoomed OUT to 80%: css = 600/0.8 = 750 → factor = 2*750/1200 = 1.25 = 1/0.8.
    expect(nativeDropScale(2, 750, 1200)).toBeCloseTo(1.25, 10);
  });

  test("measurement noise within 2% snaps to exactly 1 (scrollbars, fractional scales)", () => {
    // 1198 vs 1200: a 2px overlay-scrollbar difference must not drift coordinates.
    expect(nativeDropScale(2, 599, 1200)).toBe(1);
  });

  test("degenerate inputs → 1 (a wrong correction is worse than none)", () => {
    expect(nativeDropScale(0, 1200, 2400)).toBe(1);
    expect(nativeDropScale(NaN, 1200, 2400)).toBe(1);
    expect(nativeDropScale(2, 0, 2400)).toBe(1);
    expect(nativeDropScale(2, 1200, 0)).toBe(1);
    expect(nativeDropScale(2, 1200, -5)).toBe(1);
    expect(nativeDropScale(2, Infinity, 2400)).toBe(1);
  });
});

// The claim guard: one drop event fans out to every subscribed handler; only the FIRST
// one that decides to process it may insert. This is the coordinator-shaped test: two
// subscribe cycles (two live handlers) + one drop → exactly one insert.
describe("#30 claimNativeDrop — double-insert guard", () => {
  test("two live handlers, one drop → exactly one insert", () => {
    let inserts = 0;
    // The handler body every Editor subscription runs: claim, then insert.
    const handler = (detail: object): void => {
      if (!claimNativeDrop(detail)) return;
      inserts++;
    };
    // Two subscribe cycles left two live listeners (e.g. across an editor rebuild)…
    const listeners = [handler, handler];
    // …and ONE drop event fans out to both with the SAME detail object.
    const detail = { type: "drop", paths: ["/tmp/cat.png"], x: 10, y: 10 };
    for (const l of listeners) l(detail);
    expect(inserts).toBe(1);
  });

  test("distinct drops are claimed independently (a second drag still inserts)", () => {
    const a = { paths: ["/tmp/a.png"] };
    const b = { paths: ["/tmp/b.png"] };
    expect(claimNativeDrop(a)).toBe(true);
    expect(claimNativeDrop(b)).toBe(true); // a different drop is not blocked
    expect(claimNativeDrop(a)).toBe(false); // but re-processing the same one is
    expect(claimNativeDrop(b)).toBe(false);
  });
});
