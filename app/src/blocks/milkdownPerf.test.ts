// app/src/blocks/milkdownPerf.bench.ts
// PER-BLOCK PERF BENCHMARK — the architecture-gating measurement.
//
// RichTextBlock mounts ONE full Milkdown / ProseMirror EditorView per text block, with no
// virtualization. This harness measures the construction cost of that decision: mount N
// createBlockEditor() instances (each seeded with realistic short inline markdown) into detached
// divs, time the total wall-clock + per-instance average, and sample peak RSS before/after.
//
// CAVEAT (read the numbers honestly): happy-dom has no layout/paint engine, so this measures the
// JS construction cost (Milkdown schema build + plugin wiring + ProseMirror EditorView creation +
// initial parse), NOT real browser paint/reflow. Treat every number here as a LOWER BOUND on the
// real cost in a Chromium/WKWebView. A verdict of "too heavy" headless is conclusive; a verdict of
// "fine" headless still leaves real-paint headroom to verify.
//
// Run: bun test app/src/blocks/milkdownPerf.bench.ts

import { GlobalWindow } from "happy-dom";
import { test, expect, beforeAll, afterAll } from "bun:test";
import { createBlockEditor, type BlockEditorHandle } from "./milkdownEditor";

// Same DOM-isolation contract as milkdownSerialize.test.ts: install globals only for this file's
// lifetime, delete exactly what we added, so the headless rest-of-suite isn't polluted.
const DOM_GLOBALS = [
  "document", "window", "navigator", "Node", "Element", "HTMLElement", "Text",
  "DocumentFragment", "Event", "CustomEvent", "InputEvent", "KeyboardEvent", "MouseEvent",
  "DOMParser", "XMLSerializer", "getComputedStyle", "MutationObserver", "Range", "NodeFilter",
  "HTMLDivElement", "HTMLSpanElement", "DOMRect",
];
const installed: string[] = [];

beforeAll(() => {
  const win = new GlobalWindow();
  for (const key of DOM_GLOBALS) {
    if (!(key in globalThis) && key in win) {
      (globalThis as Record<string, unknown>)[key] = (win as unknown as Record<string, unknown>)[key];
      installed.push(key);
    }
  }
  if (!("window" in globalThis)) {
    (globalThis as Record<string, unknown>).window = win;
    installed.push("window");
  }
});

afterAll(() => {
  for (const key of installed) delete (globalThis as Record<string, unknown>)[key];
});

// A realistic spread of short inline-markdown block values (the unit a text block actually holds —
// inline content only, no block prefix). Mix of plain text, marks, links, and custom atoms so the
// schema/parse cost is exercised the way a real note's blocks would.
const SAMPLES = [
  "Just a plain sentence with a few ordinary words in it.",
  "This paragraph has **bold** and *italic* and some `inline code` too.",
  "See [the docs](https://example.com/path) and also [[Another Note]] for context.",
  "Tracking #project/alpha with a [[Design Doc|the design]] reference here.",
  "The identity $e^{i\\pi} + 1 = 0$ is elegant, per [[Euler]].",
  "A longer block of prose that runs to roughly two lines of text so the parser has more inline content to chew through, with a trailing [[link]].",
  "Mixed: **bold** [[Note]] #tag $x^2$ and a bare https://example.com/a/b url.",
  "Embed reference ![[diagram.png]] sits inline with [the source](https://cdn.x.io/i.png).",
];

function sampleFor(i: number): string {
  return SAMPLES[i % SAMPLES.length]!;
}

/** Force a GC if the runtime exposes one (Bun: --smol/--expose-gc). Best-effort; RSS is noisy. */
function maybeGc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === "function") g();
  if (typeof (Bun as unknown as { gc?: (sync: boolean) => void }).gc === "function") {
    (Bun as unknown as { gc: (sync: boolean) => void }).gc(true);
  }
}

interface Row {
  n: number;
  totalMs: number;
  perMs: number;
  rssDeltaMb: number;
  rssPerMb: number;
}

async function measure(n: number): Promise<Row> {
  const roots: HTMLElement[] = [];
  const handles: BlockEditorHandle[] = [];

  maybeGc();
  const rssBefore = process.memoryUsage().rss;
  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    roots.push(root);
    // eslint-disable-next-line no-await-in-loop -- sequential init is the worst case + what mount does
    const h = await createBlockEditor({
      root,
      value: sampleFor(i),
      onChange: () => {},
      onEnter: () => {},
      onBackspaceAtStart: () => {},
      onArrowOut: () => {},
    });
    handles.push(h);
  }

  const t1 = performance.now();
  maybeGc();
  const rssAfter = process.memoryUsage().rss;

  const totalMs = t1 - t0;
  const rssDeltaMb = (rssAfter - rssBefore) / (1024 * 1024);

  // Teardown.
  for (const h of handles) h.destroy();
  for (const r of roots) r.remove();
  maybeGc();

  return {
    n,
    totalMs,
    perMs: totalMs / n,
    rssDeltaMb,
    rssPerMb: rssDeltaMb / n,
  };
}

test("per-block Milkdown init scaling (50/100/150/200)", async () => {
  const counts = [50, 100, 150, 200];
  const rows: Row[] = [];

  // Warm-up: the very first Editor.create() pays one-time module/JIT costs we don't want to
  // attribute to the N=50 bucket. Mount + destroy a couple, untimed.
  {
    const warmRoots: HTMLElement[] = [];
    const warmHandles: BlockEditorHandle[] = [];
    for (let i = 0; i < 3; i++) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      warmRoots.push(root);
      // eslint-disable-next-line no-await-in-loop
      warmHandles.push(await createBlockEditor({
        root, value: sampleFor(i),
        onChange: () => {}, onEnter: () => {}, onBackspaceAtStart: () => {}, onArrowOut: () => {},
      }));
    }
    for (const h of warmHandles) h.destroy();
    for (const r of warmRoots) r.remove();
  }

  for (const n of counts) {
    // eslint-disable-next-line no-await-in-loop -- buckets must run sequentially for clean RSS
    rows.push(await measure(n));
  }

  // Pretty table to stdout (the deliverable).
  const fmt = (x: number, d = 1) => x.toFixed(d).padStart(9);
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Per-block Milkdown init benchmark (happy-dom, JS-construction lower bound) ===");
  lines.push("");
  lines.push(["  N", "  total(ms)", "  per(ms)", "  rssΔ(MB)", " rss/blk(MB)"].join(" | "));
  lines.push("-".repeat(64));
  for (const r of rows) {
    lines.push([
      String(r.n).padStart(3),
      fmt(r.totalMs),
      fmt(r.perMs, 2),
      fmt(r.rssDeltaMb),
      fmt(r.rssPerMb, 3),
    ].join(" | "));
  }
  lines.push("");
  console.log(lines.join("\n"));

  // Sanity: the harness actually built editors and timing is monotonic-ish.
  expect(rows.length).toBe(4);
  for (const r of rows) expect(r.totalMs).toBeGreaterThan(0);
}, 120_000);
