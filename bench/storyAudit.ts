// bench/storyAudit.ts — screenshot every story and flag the ways a component can be visibly BROKEN.
//
// WHAT THIS IS FOR, AND WHY IT IS NOT cssBaseline.ts. The baseline answers "did this change?" — it is
// a regression gate and it is worthless on day one, because it compares a story against its own
// earlier recording. This tool answers a different question with no history at all: "is this WRONG,
// right now?" A component that has rendered clipped since the day it was written is invisible to the
// baseline forever (its clipped state IS the recording) and is exactly what this is built to surface.
//
// WHY IT EMITS BOTH SIGNALS AND PICTURES, and why neither alone is enough:
//   * DOM signals catch what the eye skims past — a 3px horizontal clip, text one pixel narrower than
//     its box, an element parked 40px past the right edge. They are also cheap enough to run over
//     every story and produce a ranked list instead of an undifferentiated pile of screenshots.
//   * Signals CANNOT see wrongness that is geometrically legal. Overlapping siblings that both fit,
//     a control sitting in the wrong place, a panel whose contents are nonsense, an icon that drew
//     the wrong picture — every one of those satisfies every measurement here. Only looking finds
//     them. This repo has already been bitten three separate times by metrics that all passed while
//     the render was visibly broken (a calendar clipping two week rows while reporting 112 cells and
//     48 chips; a card rendering "Loading…" as 7 happy elements; a blank canvas with a perfect DOM).
// So: the signals are LEADS, ranked to decide where to look first. The screenshot is the evidence.
// A story with zero flags is not certified — it is merely un-flagged, and still has to be looked at.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   * It does not judge design. Spacing, colour harmony, hierarchy and consistency are out of scope;
//     the flags below all describe a component that is BROKEN, not one that is ugly.
//   * It does not freeze the clock. cssBaseline.ts does, for determinism, but a frozen Date stalls
//     readiness loops that wait for animation to settle, and this tool needs the settled frame.
//   * It does not fail. There is no exit(1) and no ratchet — it is an instrument, not a gate. Its
//     output is read by a human or an agent, and a flag is a question, never a verdict.
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "./chromeSession";

const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:6006");
const ONLY = arg("story", "");
const OUT_DIR = arg("out", join(import.meta.dir, "..", ".claude", "audit"));
const SETTLE = Number(arg("settle", "700"));
const MAX_TRIES = Number(arg("tries", "12"));
const WAIT = Number(arg("wait", "300"));
const W = 1280, H = 900;
// 2x so an agent can actually read a 10px label and tell "clipped" from "ends there". Clipped to the
// content box first, so a 200px chip does not ship a 1280x900 sea of background.
const SHOT_SCALE = 2;
const MAX_SHOT_H = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs in the page. Returns defect leads + a content bounding box + coarse stats.
 *
 * Every threshold here is deliberately slack (>2px, not >0px). Sub-pixel layout, fractional font
 * metrics and scrollbar-less measurement all produce 1px noise that would otherwise flag most of the
 * app and train the reader to ignore the output — which is the only truly fatal failure mode for an
 * instrument like this.
 */
const PROBE = `(() => {
  const flags = [];
  const add = (kind, el, detail) => {
    if (flags.length > 60) return;
    const cls = (el.getAttribute && el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 3).join(".");
    const txt = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60);
    flags.push({ kind, sel: el.tagName.toLowerCase() + (cls ? "." + cls : ""), text: txt, detail });
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  // The story's own subtree. Scanning the whole document instead sweeps in Storybook's dormant
  // chrome — .sb-nopreview, .sb-errordisplay and the docs args-table templates — which sit in the DOM
  // permanently, hidden by a display:none ANCESTOR. That produced an identical 38 zero-size + 22
  // invisible-text on four completely unrelated stories: a flood of false leads, which is the one
  // failure mode that actually destroys an instrument like this, because it teaches the reader to
  // skim past the output.
  // Story root AND portals — the same blind spot that hid twelve stories from the computed-style
  // gate. Every modal in this app (ui-modal, the five app modals, FolderPrompt) and the symbol
  // gallery renders through a Solid <Portal> into document.body, so scoping to #storybook-root alone
  // would audit the empty space where the modal ISN'T and report a clean result for all of them.
  const SB_IDS = ["storybook-root", "storybook-docs", "storybook-highlights-root"];
  const isChrome = (el) =>
    el.tagName === "SCRIPT" || el.tagName === "STYLE" ||
    (el.id && SB_IDS.indexOf(el.id) >= 0) ||
    /\\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\\b/.test(el.getAttribute("class") || "");
  const storyRoot = document.querySelector("#storybook-root");
  const roots = [];
  if (storyRoot) roots.push(storyRoot);
  for (const el of Array.prototype.slice.call(document.body.children)) {
    if (el !== storyRoot && !isChrome(el)) roots.push(el);
  }
  if (roots.length === 0) roots.push(document.body);
  const all = [];
  for (const r of roots) {
    all.push(r);
    for (const el of Array.prototype.slice.call(r.querySelectorAll("*"))) all.push(el);
  }
  let visible = 0, textLen = 0, canvases = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Direct text only: a wrapper "contains" all its descendants' text, so using textContent here would
  // attribute a child's clipping to every ancestor and bury the real element.
  const ownText = (el) => Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();

  const effectiveBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== "transparent" && !/rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(bg)) return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.documentElement).backgroundColor || "rgb(255, 255, 255)";
  };

  for (const el of all) {
    let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
    // checkVisibility, NOT a display/visibility test on the element itself. An element inside a
    // display:none ANCESTOR reports its own display as whatever it specified (inline, block…) and
    // visibility as visible, while measuring 0x0 — so the naive test lets the entire dormant subtree
    // through and every text node in it lands as a zero-size false positive.
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    const painted = r.width > 0 && r.height > 0 && Number(cs.opacity) > 0.01;
    if (painted) {
      visible++;
      if (r.width < vw * 2 && r.height < vh * 3) {
        minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
      }
    }
    if (el.tagName === "CANVAS") canvases++;
    const own = ownText(el);
    textLen += own.length;

    const hidX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const hidY = cs.overflowY === "hidden" || cs.overflowY === "clip";

    // Content wider than its box, with the overflow clipped away. Ellipsis is excluded here and
    // reported separately: truncating a long path on purpose and severing a button label by accident
    // are the same measurement but opposite intentions, and only a human can tell them apart.
    if (hidX && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      if (cs.textOverflow === "ellipsis") {
        if (own) add("ellipsis-active", el, el.scrollWidth + "px content in " + el.clientWidth + "px box");
      } else {
        add("clip-x", el, el.scrollWidth + "px content in " + el.clientWidth + "px box (overflow-x:" + cs.overflowX + ")");
      }
    }
    // Vertical clipping of TEXT specifically. A scroll container legitimately has more content than
    // height, so this only fires where the overflow is hidden and the element owns text directly —
    // which is the "[ ]" send-icon shape: a glyph wrapping to a second line inside a one-line box.
    if (hidY && own && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      add("clip-y", el, el.scrollHeight + "px content in " + el.clientHeight + "px box (overflow-y:" + cs.overflowY + ")");
    }
    // Text that occupies no space at all. Almost always a flex/grid child that lost its basis.
    if (own && painted === false && Number(cs.opacity) > 0.01 && (r.width === 0 || r.height === 0)) {
      add("zero-size", el, "rect " + Math.round(r.width) + "x" + Math.round(r.height) + " but has text");
    }
    if (painted && r.left > vw + 4) add("offscreen-right", el, "left edge at " + Math.round(r.left) + "px, viewport " + vw + "px");
    if (painted && r.right < -4) add("offscreen-left", el, "right edge at " + Math.round(r.right) + "px");
    // Same colour as what is behind it. Guarded on background-clip:text, which is how the wordmark
    // paints a gradient THROUGH the glyphs and legitimately sets color:transparent.
    if (own && cs.webkitBackgroundClip !== "text" && cs.backgroundClip !== "text") {
      const c = cs.color;
      if (/rgba\\(.*,\\s*0\\)$/.test(c)) add("invisible-text", el, "color " + c);
      else if (c === effectiveBg(el)) add("invisible-text", el, "color " + c + " equals background");
    }
    if (own && parseFloat(cs.fontSize) < 8) add("tiny-font", el, "font-size " + cs.fontSize);
  }

  if (document.documentElement.scrollWidth > vw + 2) {
    flags.push({ kind: "page-overflow-x", sel: ":root", text: "",
      detail: document.documentElement.scrollWidth + "px wide in a " + vw + "px viewport" });
  }
  // A story that mounted but drew nothing. Canvas stories legitimately have almost no text and no
  // elements, so they are excused here and judged from the screenshot instead.
  if (visible <= 2 && textLen === 0 && canvases === 0) {
    flags.push({ kind: "empty-render", sel: ":root", text: "", detail: visible + " painted elements, no text, no canvas" });
  }

  const pad = 12;
  const box = (minX === Infinity)
    ? { x: 0, y: 0, width: Math.min(vw, 600), height: Math.min(vh, 400) }
    : {
        x: Math.max(0, Math.floor(minX - pad)),
        y: Math.max(0, Math.floor(minY - pad)),
        width: Math.min(vw, Math.ceil(maxX - Math.max(0, minX - pad) + pad)),
        height: Math.min(${MAX_SHOT_H}, Math.ceil(maxY - Math.max(0, minY - pad) + pad)),
      };
  box.width = Math.max(32, box.width); box.height = Math.max(32, box.height);

  return JSON.stringify({ flags, box, stats: { visible, textLen, canvases } });
})()`;

const index = await (await fetch(`${BASE}/index.json`)).json();
const matches = (id: string) => !ONLY || id === ONLY || id.startsWith(ONLY);
const entries = Object.values(index.entries as Record<string, any>)
  .filter((e: any) => matches(e.id))
  .sort((a: any, b: any) => a.id.localeCompare(b.id));
if (entries.length === 0) throw new Error(`no stories matched (--story ${ONLY})`);

if (existsSync(OUT_DIR) && !ONLY) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, "shots"), { recursive: true });

// deviceScaleFactor stays 1 and the SCALE is applied on the capture clip instead. Setting both
// compounds them, which silently yields 4x images and a report nobody can open.
const session = await launchChrome({
  label: "audit", width: W, height: H,
  flags: ["--force-prefers-reduced-motion"],
  rpcError: (m, e) => new Error(`${m}: ${e.message ?? JSON.stringify(e)}`),
});
const { page } = session;
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const report: any[] = [];
let done = 0;

for (const e of entries as any[]) {
  const id = e.id;
  process.stderr.write(`\r[${++done}/${entries.length}] ${id.slice(0, 60).padEnd(60)}`);
  const rec: any = { id, title: e.title, name: e.name, importPath: e.importPath, flags: [], stats: null, shot: null };
  try {
    await page("Page.navigate", { url: `${BASE}/iframe.html?id=${id}&viewMode=story` });
    await sleep(SETTLE);

    // Converge on a settled frame rather than guessing a delay. Two consecutive identical probes is
    // enough here (the baseline needs three, because it is diffing exact numbers and must not record
    // a transient; this tool only needs the picture to have stopped moving).
    let prev = "", parsed: any = null;
    for (let i = 0; i < MAX_TRIES; i++) {
      const r = await page("Runtime.evaluate", { expression: PROBE, returnByValue: true, awaitPromise: false });
      const v = r?.result?.value;
      if (typeof v !== "string") { await sleep(WAIT); continue; }
      if (v === prev) { parsed = JSON.parse(v); break; }
      prev = v;
      await sleep(WAIT);
    }
    if (!parsed) parsed = prev ? JSON.parse(prev) : { flags: [{ kind: "probe-failed", sel: ":root", text: "", detail: "never settled" }], box: { x: 0, y: 0, width: 600, height: 400 }, stats: null };

    rec.flags = parsed.flags;
    rec.stats = parsed.stats;

    const shot = await page("Page.captureScreenshot", {
      format: "png",
      clip: { ...parsed.box, scale: SHOT_SCALE },
      captureBeyondViewport: false,
    });
    const file = `${id.replace(/[^a-z0-9-]/gi, "_")}.png`;
    writeFileSync(join(OUT_DIR, "shots", file), Buffer.from(shot.data, "base64"));
    rec.shot = join("shots", file);
  } catch (err) {
    rec.flags.push({ kind: "crashed", sel: ":root", text: "", detail: String((err as Error).message).slice(0, 200) });
  }
  report.push(rec);
}
process.stderr.write("\r" + " ".repeat(80) + "\r");

writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

const counts = new Map<string, number>();
for (const r of report) for (const f of r.flags) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
const flagged = report.filter((r) => r.flags.length);

console.log(`${report.length} stories -> ${OUT_DIR}`);
console.log(`${flagged.length} carry at least one lead; ${report.length - flagged.length} are un-flagged (NOT the same as verified — every story still has to be looked at)`);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

session.close();
