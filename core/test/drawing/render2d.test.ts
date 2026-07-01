import { test, expect } from "bun:test";
import { renderPage, type Ctx2D } from "../../src/drawing/render2d";
import { emptyDoc, PAGE_W, PAGE_H } from "../../src/drawing/model";
import { themeColors } from "../../src/drawing/theme";

function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "calls") return calls;
      return (...args: unknown[]) => { calls.push(`${prop}(${args.join(",")})`); };
    },
    set(_t, prop: string, value: unknown) { calls.push(`${String(prop)}=${String(value)}`); return true; },
  });
  return ctx as Ctx2D & { calls: string[] };
}

test("renderPage fills the paper background then draws each stroke", () => {
  const doc = emptyDoc();
  doc.paper.bg = "grid";
  doc.pages[0].strokes.push({ t: "pen", c: "fg", w: 4, pts: [10, 10, 255, 40, 40, 255] });
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H);
  const joined = (ctx as any).calls.join("|");
  expect(joined).toContain("fillRect(0,0,816,1056)");
  expect(joined).toContain("beginPath");
  expect(joined).toContain("fill(");
});

test("highlighter strokes use multiply compositing", () => {
  const doc = emptyDoc();
  doc.pages[0].strokes.push({ t: "hl", c: "#e23b3b", w: 8, pts: [0, 0, 255, 50, 0, 255] });
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H);
  expect((ctx as any).calls.join("|")).toContain("globalCompositeOperation=multiply");
});

test("renderPage blits a resolved image on top of the paper but under the ink", () => {
  const doc = emptyDoc();
  doc.paper.bg = "blank"; // isolate the ordering: blank paper = just the bg fillRect
  doc.pages[0].images = [{ src: "data:image/png;base64,XYZ", x: 10, y: 20, w: 100, h: 50 }];
  doc.pages[0].strokes.push({ t: "pen", c: "fg", w: 4, pts: [0, 0, 255, 30, 30, 255] });
  const ctx = recorder();
  const seen: string[] = [];
  // The resolver is handed the EXACT stored src (same contract the headless export uses), and
  // whatever handle it returns is blitted verbatim — render2d applies NO tint/recolor to it.
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H, (src) => { seen.push(src); return "IMG"; });
  expect(seen).toEqual(["data:image/png;base64,XYZ"]);
  const calls = (ctx as any).calls as string[];
  const bg = calls.findIndex((c) => c.startsWith("fillRect(0,0,816,1056"));
  const img = calls.findIndex((c) => c.startsWith("drawImage(IMG,10,20,100,50"));
  const ink = calls.findIndex((c) => c === "fill()");
  expect(bg).toBeGreaterThanOrEqual(0);
  expect(img).toBeGreaterThan(bg); // image over the background (so the theme wash can't tint it)
  expect(ink).toBeGreaterThan(img); // ink over the image (annotations land on top)
});

test("renderPage skips an image whose src hasn't decoded yet (resolver → undefined)", () => {
  const doc = emptyDoc();
  doc.paper.bg = "blank";
  doc.pages[0].images = [{ src: "data:pending", x: 0, y: 0, w: 50, h: 50 }];
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H, () => undefined);
  expect((ctx as any).calls.join("|")).not.toContain("drawImage");
});

test("renderPage with images but NO resolver draws nothing for them (back-compat)", () => {
  const doc = emptyDoc();
  doc.pages[0].images = [{ src: "data:x", x: 0, y: 0, w: 10, h: 10 }];
  const ctx = recorder();
  renderPage(ctx, doc.pages[0], doc.paper, themeColors("dark"), PAGE_W, PAGE_H);
  expect((ctx as any).calls.join("|")).not.toContain("drawImage");
});
