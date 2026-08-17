// bench/cssBaseline.ts — computed-style baseline for every Storybook story.
//
// WHY THIS EXISTS. Moving ~330 rules out of a global stylesheet into CSS Modules is a refactor
// whose whole promise is "nothing changed visually". Eyeballing 239 stories cannot establish that,
// and a typecheck cannot see CSS at all. This records what the browser ACTUALLY resolved for every
// element in every story, so a migration either diffs to zero or names exactly what it broke.
//
// WHY IT DRIVES ITS OWN CHROME: see bench/chromeSession.ts, which owns the launch, the flag set and
// the teardown for every tool in here — a background automation tab reports visibilityState "hidden"
// and rAF-gated components never paint.
//
// DETERMINISM. Four things would otherwise make consecutive runs disagree, and a flaky gate is worse
// than no gate because it trains the next reader to ignore it. Each of these was found the same way:
// a full record-then-check cycle reporting nonzero drift with no CSS having changed.
//   1. Keyframe animations. The design system has a blinking caret (.asc-caret animates opacity) and
//      the wordmark sheen (animates background-position). Sampling mid-flight returns a different
//      number every run. Inject `animation: none` before reading. TRANSITIONS are deliberately left
//      alone — a transition's computed duration is static and worth diffing.
//   2. Webfonts. Monaspace loads async; measuring before it lands records fallback-font metrics.
//      Await document.fonts.ready.
//   3. Wall-clock time. bases-calendarview--* grids out-of-month cells relative to TODAY, so the same
//      structural path is a normal cell one day and a dimmed one the next — that alone produced 98
//      drift lines (rgb(232,227,214) -> color(srgb … / 0.6)) across two runs a day apart. Story
//      fixtures also call Date.now() at module scope. So Date is frozen (see FREEZE) before any story
//      code runs, and the timezone is pinned to UTC. performance.now() is deliberately left real:
//      rAF, transitions and editor measurement all depend on time actually advancing.
//   4. Async component settling. A fixed sleep is a guess, and the guess loses under load.
//      app-blockeditor--default (Milkdown, a dynamic import) was still showing its loading state at
//      2000ms in one run and fully mounted in the next — 20 drift lines including NEW element for the
//      whole mounted subtree. So the harness CONVERGES instead of guessing: it re-probes until STABLE
//      consecutive captures are byte-identical. A story that never settles is named in a warning
//      rather than silently recorded at whatever it happened to look like.
//
//   cd app && bun run storybook          # in another shell
//   bun bench/cssBaseline.ts --update    # record
//   bun bench/cssBaseline.ts             # check (exit 1 on drift)
// rmSync here is for the generated drift dump, NOT for a Chrome profile — profile cleanup lives in
// chromeSession.ts.
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "./chromeSession";

const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n: string) => process.argv.includes(`--${n}`);
const BASE = arg("base", "http://localhost:6006");
const ONLY = arg("story", "");
// SETTLE is only the head start before convergence takes over, not the thing being relied on. Raising
// a fixed sleep was tried first and does not work: 700ms missed Univer's async toolbar theming,
// 1500ms still let one story flake under full-suite CPU load, and 2000ms still caught Milkdown
// mid-mount. The duration that is enough is a property of the machine's load that day, which is
// exactly what a fixed number cannot encode. STABLE identical consecutive captures can.
const SETTLE = Number(arg("settle", "800"));
/** How many byte-identical consecutive captures mean "this story has stopped moving". Two is not
 *  enough: a dynamic import can hold a stable loading state across one interval and then swap. */
const STABLE = Number(arg("stable", "3"));
const CONVERGE_WAIT = Number(arg("wait", "350"));
const MAX_TRIES = Number(arg("tries", "16"));
/** Frozen wall clock. Any fixed instant works; this one is a Thursday mid-month, so a month grid has
 *  both leading and trailing out-of-month cells and the calendar stories exercise both. */
const FROZEN_NOW = Date.parse("2026-01-15T12:00:00Z");
const UPDATE = has("update");
const OUT = join(import.meta.dir, "css-baseline.json");
/** Full drift dump on a failing run — generated, gitignored, overwritten every run. */
const DRIFT = join(import.meta.dir, "css-baseline.drift.txt");
const W = 1280, H = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The properties worth tracking. Deliberately NOT every property: the full computed set is ~340
 *  properties per element, which makes the baseline enormous and full of values no CSS in this repo
 *  ever sets. These are the ones this codebase's rules actually control. */
const PROPS = [
  "display","position","top","right","bottom","left","z-index","overflow-x","overflow-y",
  "width","height","min-width","min-height","max-width","max-height",
  "margin-top","margin-right","margin-bottom","margin-left",
  "padding-top","padding-right","padding-bottom","padding-left",
  "flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis","align-items","justify-content","gap",
  "grid-template-columns","grid-template-rows",
  "font-family","font-size","font-weight","font-style","line-height","letter-spacing","text-transform",
  "text-align","text-decoration-line","white-space","text-overflow","font-variant-numeric",
  "color","background-color","background-image","opacity","visibility",
  "border-top-width","border-right-width","border-bottom-width","border-left-width",
  "border-top-color","border-right-color","border-bottom-color","border-left-color",
  "border-top-left-radius","border-top-right-radius","border-bottom-left-radius","border-bottom-right-radius",
  "box-shadow","backdrop-filter","transform","transition-property","transition-duration","cursor",
];

/** Serialize one story as { ref: {prop: value}, els: { stablePath: {prop: value} } }.
 *  The path is structural (tag + nth-child chain), NOT class-based — class names are exactly what
 *  CSS Modules change, so keying on them would make every migration look like a total rewrite.
 *
 *  DEVIATIONS ONLY. Recording every property's raw value for every element made the baseline tens of
 *  megabytes, almost all of it `none`/`0px`/etc — properties sitting at their initial value, which no
 *  CSS in this repo ever sets. Instead: build one bare reference element in `body` (so it inherits
 *  body's font-family/color/font-size/line-height the same way any other bare element would), read
 *  PROPS off it, and only keep a real element's value for a property when it differs from that
 *  reference. An element with zero deviations still gets an (empty) entry so NEW/REMOVED element
 *  detection keeps working; a missing property inside an entry means "the reference's value".
 *
 *  THE REFERENCE IS RECORDED, NOT RE-MEASURED. It is not a constant — it is whatever the ambient
 *  global CSS resolves to at capture time. If a migration drops a global inherited rule (this repo
 *  has `body { color: var(--fg) }`), the affected elements AND the bare reference fall back to the
 *  browser default together, so a purely relative comparison would see "omitted vs omitted" on both
 *  sides and report an app-wide regression as zero drift. Persisting `ref` per story and resolving
 *  `els[path][prop] ?? ref[prop]` on BOTH sides before comparing keeps the file-size win while making
 *  that lockstep drift visible. */
const PROBE = `(async () => {
  document.querySelectorAll("style[data-cssbaseline]").forEach((n) => n.remove());
  const kill = document.createElement("style");
  kill.setAttribute("data-cssbaseline", "1");
  kill.textContent = "*, *::before, *::after { animation: none !important; }";
  document.head.appendChild(kill);
  try { await document.fonts.ready; } catch {}
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const PROPS = ${JSON.stringify(PROPS)};
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const i = n.parentElement ? Array.prototype.indexOf.call(n.parentElement.children, n) : 0;
      parts.unshift(n.tagName.toLowerCase() + "[" + i + "]");
    }
    return parts.join(">");
  };

  const ref = document.createElement("div");
  document.body.appendChild(ref);
  const refCs = getComputedStyle(ref);
  const defaults = {};
  for (const p of PROPS) defaults[p] = refCs.getPropertyValue(p);
  ref.remove();

  const out = {};
  const all = document.querySelectorAll("body *");
  for (const el of all) {
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v !== defaults[p]) rec[p] = v;
    }
    out[path(el)] = rec;
  }
  return JSON.stringify({ count: all.length, ref: defaults, els: out });
})()`;

/** Installed via Page.addScriptToEvaluateOnNewDocument, so it runs before ANY story code — including
 *  the module-scope `const NOW = Date.now()` several story fixtures use. Only the wall clock is
 *  frozen; performance.now() is untouched, because rAF, transitions and CodeMirror's own measurement
 *  all need time to keep advancing. Date is replaced with a function rather than a class so that
 *  calling it without `new` still returns a string, as the real constructor does. */
const FREEZE = `(() => {
  const F = ${FROZEN_NOW};
  const R = Date;
  function D(...a) {
    if (new.target === undefined) return new R(F).toString();
    return a.length === 0 ? new R(F) : new R(...a);
  }
  D.prototype = R.prototype;
  D.now = () => F;
  D.parse = R.parse.bind(R);
  D.UTC = R.UTC.bind(R);
  Object.setPrototypeOf(D, R);
  window.Date = D;
})()`;

const index = await (await fetch(`${BASE}/index.json`)).json();
// --story takes an exact id OR a PREFIX. Exact-only was a footgun: story ids are
// "<component>--<case>", so the natural thing to type for a component — `--story shell-windowcontrols`
// — matched nothing and threw, and the per-component workflow this harness is used for is exactly
// "record every case of the thing I just changed". Prefix matching makes that one command. The
// matched set is always printed, because a filter that silently covers more than you meant is worse
// than one that covers less.
const matchesOnly = (id: string) => !ONLY || id === ONLY || id.startsWith(ONLY);
const storyIds = Object.keys(index.entries).filter(matchesOnly).sort();
if (storyIds.length === 0) throw new Error(`no stories matched (--story ${ONLY})`);
if (ONLY) console.error(`--story ${ONLY} matched ${storyIds.length}: ${storyIds.join(", ")}`);

// Launch, port poll, CDP attach and teardown are chromeSession.ts's — including the SIGKILL-then-retry
// profile delete that this harness needed after leaking 20 profiles / 600 MB, and which two sibling
// tools each got wrong in their own way before it was shared.
//
// `--force-prefers-reduced-motion` is passed explicitly, not defaulted in the helper: visual.ts must
// NOT have it, because its readiness loop waits for animation to settle.
const session = await launchChrome({
  label: "cssbase", width: W, height: H, flags: ["--force-prefers-reduced-motion"],
});
const { page } = session;
// PER-TOOL, deliberately not in the helper: this harness needs a fixed viewport at scale 1, a pinned
// timezone and a frozen clock (see DETERMINISM above). visual.ts renders at scale 2 and needs real
// time, so none of the three can be a shared default.
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
// UTC, not the host zone: a calendar rendering local dates would otherwise shift with whoever runs it.
await page("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
await page("Page.addScriptToEvaluateOnNewDocument", { source: FREEZE });

const captured: Record<string, any> = {};
const empty: string[] = [];
// Progress goes to stderr every story. A full run holds the terminal for minutes with nothing to
// show, which reads as a hang — and any supervisor watching the stream (a subagent watchdog, CI's
// no-output timeout) will kill it on exactly that silence. \r keeps it to one line interactively.
const unstable: string[] = [];

/** Probe the CURRENTLY-LOADED page until it stops changing, then return the capture.
 *
 *  CONVERGENCE PROVES STABILITY, NOT COMPLETENESS, and that distinction cost a false alarm. Univer
 *  (app-sheetview) and Milkdown (app-blockeditor) mount in stages, and under CPU contention a stage
 *  can PLATEAU for longer than the stability window — so three identical captures in a row are a real
 *  measurement of a half-mounted component. The full run reported 2727 REMOVED elements across those
 *  stories with no warning, while re-checking each in isolation gave `0 changed`. Hence the
 *  drift-retry pass below: a plateau is broken by re-loading the story on its own, and a real
 *  regression survives that. */
const captureOne = async (id: string, settle: number, wait: number) => {
  await sleep(settle);
  let last = "", value = "", same = 0;
  for (let i = 0; i < MAX_TRIES; i++) {
    const r = await page("Runtime.evaluate", { expression: PROBE, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) { console.error(`\nSKIP ${id}: ${r.exceptionDetails.text}`); return null; }
    value = r.result.value;
    same = value === last ? same + 1 : 0;
    last = value;
    if (same >= STABLE - 1) break;
    await sleep(wait);
  }
  const parsed = JSON.parse(value);
  return { ref: parsed.ref, els: parsed.els, count: parsed.count as number, settled: same >= STABLE - 1 };
};

let done = 0;
for (const id of storyIds) {
  process.stderr.write(`\r[${++done}/${storyIds.length}] ${id.slice(0, 60).padEnd(60)}`);
  // A CDP call can reject outright — "Session with given id not found" when the renderer falls over,
  // which happened once at story 185 of 247 under memory pressure from a second browser. Left
  // unhandled that surfaces as a raw protocol error with a stack pointing at the RPC helper and NO
  // indication of which story was in flight, which is the least useful possible failure. Name the
  // story, then rethrow: a half-finished run must not be mistaken for a pass.
  try {
    await page("Page.navigate", { url: `${BASE}/iframe.html?id=${id}&viewMode=story` });
  } catch (e) {
    process.stderr.write("\n");
    throw new Error(`CDP died navigating to "${id}" (story ${done}/${storyIds.length}): ${(e as Error).message}`);
  }
  const got = await captureOne(id, SETTLE, CONVERGE_WAIT);
  if (!got) continue;
  if (!got.settled) unstable.push(id);
  if (got.count === 0) empty.push(id);
  captured[id] = { ref: got.ref, els: got.els };
}
process.stderr.write("\n");
// The browser is NOT released here. It was, until the drift-retry pass below needed to re-load a
// story — and closing first turned every retry into a dead-session catch that silently kept the
// first-pass verdict. close() is idempotent and registered on process exit; the explicit call now sits
// after the retry.

if (empty.length) console.error(`WARNING: ${empty.length} story(s) rendered 0 elements — unprotected:\n  ${empty.join("\n  ")}`);
if (unstable.length) console.error(`WARNING: ${unstable.length} story(s) never converged in ${MAX_TRIES} probes — their values are arbitrary and will flake:\n  ${unstable.join("\n  ")}`);

if (UPDATE) {
  // A partial re-record (--update --story <id>) must MERGE, not replace: writing `captured` whole
  // would silently wipe the snapshot for the other 239 stories, and re-recording just the story a
  // task touched is the natural per-task workflow. Full --update still replaces everything, so a
  // story deleted from Storybook drops out of the baseline the way it should.
  let next = captured;
  if (ONLY && existsSync(OUT)) next = { ...JSON.parse(readFileSync(OUT, "utf8")), ...captured };
  writeFileSync(OUT, JSON.stringify(next, null, 1));
  console.log(`recorded ${Object.keys(captured).length} stories -> ${OUT} (${Object.keys(next).length} total)`);
  process.exit(0);
}

if (!existsSync(OUT)) throw new Error(`no baseline at ${OUT} — run with --update first`);
const base = JSON.parse(readFileSync(OUT, "utf8"));
const diffs: string[] = [];
// Entries are DEVIATIONS-FROM-`ref` (see PROBE), so a property absent from an entry does NOT mean
// "unchanged" — it means "whatever this run's reference resolved to". Comparing the stored keys
// directly would let a global inherited rule vanish from both the element and the reference at once
// and read as no drift. So resolve every property on both sides against ITS OWN recorded reference
// first, and walk the full PROPS list rather than only the keys that happen to be present.
const resolve = (rec: Record<string, string> | undefined, ref: Record<string, string>, prop: string) =>
  rec?.[prop] ?? ref[prop] ?? "[absent]";
/** All drift lines for ONE story, or [] if it matches. Pure, so the retry pass can reuse it. */
const diffStory = (id: string, c: { ref: Record<string, string>; els: Record<string, any> }): string[] => {
  const out: string[] = [];
  const b = base[id];
  if (!b) return [`${id}: NEW story (no baseline)`];
  if (!b.ref || !b.els) throw new Error(`baseline story "${id}" predates the recorded-reference schema — re-record with --update`);
  const bRef = b.ref as Record<string, string>, cRef = c.ref;
  // Reference drift is reported in its own right: it is the app-wide signal, and without it a
  // dropped global rule reads only as a wall of per-element lines with no stated cause.
  for (const prop of PROPS) {
    if (bRef[prop] !== cRef[prop]) out.push(`${id} [reference] ${prop}: ${bRef[prop] ?? "[absent]"} -> ${cRef[prop] ?? "[absent]"}`);
  }
  const allPaths = new Set([...Object.keys(b.els), ...Object.keys(c.els)]);
  for (const p of allPaths) {
    const bp = b.els[p], cp = c.els[p];
    if (!bp) { out.push(`${id} ${p}: NEW element`); continue; }
    if (!cp) { out.push(`${id} ${p}: REMOVED element`); continue; }
    for (const prop of PROPS) {
      const bv = resolve(bp, bRef, prop);
      const cv = resolve(cp, cRef, prop);
      if (bv !== cv) out.push(`${id} ${p} ${prop}: ${bv} -> ${cv}`);
    }
  }
  return out;
};

const perStory = new Map<string, string[]>();
for (const id of Object.keys(captured)) perStory.set(id, diffStory(id, captured[id]));

// RETRY the drifted stories, one at a time, with a fresh load and more patience.
//
// A full 247-story sweep runs the machine hot, and a staged mounter (Univer, Milkdown) can plateau
// mid-mount for longer than the stability window — so the convergence loop measures a half-built
// component and, because it IS stable, reports no warning. That produced 2727 phantom REMOVED
// elements in one run while re-checking the same stories alone gave `0 changed`. A real regression is
// deterministic and survives the retry; contention does not. This costs nothing on a clean run,
// because there is nothing to retry.
// Capped at a QUARTER of the run. Contention hits a handful of heavy stories; an app-wide change
// (a font swap, a rule on every icon) drifts most of them, and retrying those would double a
// 12-minute sweep to re-confirm a change the author already knows they made. Above the cap the
// first-pass verdict stands and the cap is announced, so a skipped retry is never silent.
const RETRY_CAP = Math.max(8, Math.floor(storyIds.length / 4));
const drifted = [...perStory].filter(([, d]) => d.length).map(([id]) => id);
if (drifted.length > RETRY_CAP && !UPDATE) {
  process.stderr.write(`${drifted.length} of ${storyIds.length} stories drifted — above the ${RETRY_CAP} retry cap, so this reads as an intended app-wide change, not contention. Reporting the first pass as-is.\n`);
} else if (drifted.length && !UPDATE) {
  process.stderr.write(`re-checking ${drifted.length} drifted story(s) in isolation before reporting…\n`);
  for (const id of drifted) {
    try {
      await page("Page.navigate", { url: `${BASE}/iframe.html?id=${id}&viewMode=story` });
    } catch { break; }  // session gone; keep the first-pass verdict rather than silently passing
    const again = await captureOne(id, SETTLE * 2, CONVERGE_WAIT * 2);
    if (!again) continue;
    const d2 = diffStory(id, again);
    if (d2.length < perStory.get(id)!.length) {
      process.stderr.write(`  ${id}: ${perStory.get(id)!.length} -> ${d2.length} on retry\n`);
    }
    perStory.set(id, d2);
    if (d2.length === 0) captured[id] = { ref: again.ref, els: again.els };
  }
}
for (const d of perStory.values()) diffs.push(...d);
session.close();
// A story whose probe threw was logged SKIP and never landed in `captured`. Iterating only the
// captured side would let it drop out of the comparison entirely with the exit code still 0 — the
// story-level version of the same union rule applied to properties above.
for (const id of Object.keys(base)) {
  if (!matchesOnly(id)) continue;
  if (!(id in captured)) diffs.push(`${id}: MISSING from capture (story errored or was removed)`);
}
console.log(diffs.slice(0, 200).join("\n"));
if (diffs.length > 200) console.log(`… and ${diffs.length - 200} more`);
// The terminal cap is for readability, but the truncated remainder is where a real regression hides
// inside an expected-looking diff: an intentional app-wide change (a font swap, a white-space rule
// on every icon) easily produces four figures of drift, and reviewing only the first 200 lines means
// grading the change by its most boring rows. Always write the FULL list somewhere greppable.
if (diffs.length) {
  writeFileSync(DRIFT, diffs.join("\n") + "\n");
  console.log(`full diff -> ${DRIFT}`);
} else {
  // A clean run must DELETE the dump, not just decline to write one. Leaving the previous failing
  // run's file on disk means the next reader greps a stale drift list against a passing run and
  // believes it — the exact confusion this file exists to prevent.
  try { rmSync(DRIFT, { force: true }); } catch {}
}
console.log(`${diffs.length} changed`);
process.exit(diffs.length === 0 ? 0 : 1);
