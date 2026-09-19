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
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchChrome, type Cdp } from './chromeSession'
import { poolSize } from './poolSize'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const has = (n: string) => process.argv.includes(`--${n}`)
const BASE = arg('base', 'http://localhost:6006')
const ONLY = arg('story', '')
/* DERIVED, not a hardcoded constant — see bench/poolSize.ts. 8, matching invariants.ts/playCheck.ts
   rather than storyAudit.ts's 12: this tool shares their risk, not storyAudit's. storyAudit's higher
   ceiling is safe specifically BECAUSE a late, CPU-starved mount just costs it another screenshot
   iteration; this harness instead needs every element's COMPUTED STYLE to be byte-identical across
   probes, and font/layout timing is exactly what heavier contention perturbs — see the KNOWN
   NONDETERMINISTIC STORIES note below (a small inline element's height flipping 16<->18 / 10<->12
   under parallel load). Keeping the ceiling at 8 rather than 12 is a deliberate hedge against that. */
const CONCURRENCY = Number(arg('concurrency', String(poolSize(8))))
// SETTLE is only the head start before convergence takes over, not the thing being relied on. Raising
// a fixed sleep was tried first and does not work: 700ms missed Univer's async toolbar theming,
// 1500ms still let one story flake under full-suite CPU load, and 2000ms still caught Milkdown
// mid-mount. The duration that is enough is a property of the machine's load that day, which is
// exactly what a fixed number cannot encode. STABLE identical consecutive captures can.
// 1500, raised from 800 after measuring: app-sheetview reaches its final 538 elements by ~1500ms on
// an idle machine, and a shorter head start lets the probe begin while the story is still the 3-element
// pre-import shell. Network-idle gating catches most of that, but not the window where the chunk has
// DOWNLOADED and is still parsing — no requests in flight, no DOM movement, and nothing mounted yet.
// Three guards now overlap: this head start, network idle, and the growth escalation in captureOne.
// Costs ~0.7s x 264 stories on the sweep, which is worth paying for a gate that can be believed.
/* 1500. An earlier revision set this to 400 on the reasoning below, and 400 was REVERTED: it did not
 * fix app-sheetview (which stalls for reasons unrelated to when we start looking) and it changes the
 * first-capture timing of all ~425 other stories, which risks silently re-recording their baselines.
 * The staircase analysis is kept because it is accurate and explains the growth escalation's purpose.
 *
 * ORIGINAL NOTE — a LATE first probe is more dangerous than an early one.
 *
 * Measured mount timeline for app-sheetview (element count vs ms, three cold loads):
 *   0 -> 2 -> 3 -> 464 -> 465 -> 530 -> 538   (complete by 1746ms)
 *   0 -> 464 -> 465 -> 530 -> 538             (complete by 1376ms)
 *   0 -> 2 -> 464 -> 530 -> 538               (complete by 3004ms)
 * A 1500ms head start lands the FIRST capture in the middle of that staircase — on 464 or 530.
 * The growth escalation below can then never fire, because growth is only visible to something that
 * saw the smaller number first, and a plateau that outlasts the stability window is recorded as a
 * finished spreadsheet with its toolbar missing. Every capture in that window is genuinely identical,
 * so nothing warns. This is why raising MAX_TRIES did not fix the flake: the loop was breaking EARLY,
 * not running out of budget.
 *
 * Starting at 400ms puts the first capture reliably BEFORE Univer mounts (it is 0 at 400ms in all
 * three runs above), so the staircase is always witnessed and escalation always engages. Starting
 * early is safe because an empty capture never counts toward stability (see captureOne), so the extra
 * probes cost nothing but a few hundred ms. Ordinary synchronous stories have fully rendered well
 * before 400ms, so their first capture is still non-empty and they still settle in STABLE probes. */
const SETTLE = Number(arg('settle', '1500'))
/** How many byte-identical consecutive captures mean "this story has stopped moving". Two is not
 *  enough: a dynamic import can hold a stable loading state across one interval and then swap.
 *
 *  FOUR, not three, and the wait is 400ms rather than 350 — so a story must hold still for 1200ms
 *  instead of 700ms before it is believed. Measured cause: app-sheetview mounts Univer in stages and
 *  goes 3 elements -> 469 -> 538 between 500ms and 1500ms on an IDLE machine. Each of those steps is
 *  a plateau, and under the CPU load of a 264-story run the plateaus stretch until one of them
 *  outlasts the stability window — at which point the harness records a half-built spreadsheet, with
 *  every capture in the window genuinely identical and therefore no warning. That is how a 578-element
 *  diff appears on a story nobody edited. Widening the window does not eliminate the failure (a long
 *  enough stall always can), which is why the drift-retry pass below still exists as the backstop. */
const STABLE = Number(arg('stable', '4'))
const CONVERGE_WAIT = Number(arg('wait', '400'))
/** Upper bound on convergence probes. This is a CEILING, not a cost: a story that settles exits at
 *  `need` identical captures, so the ~420 stories that mount promptly never approach it and pay
 *  nothing for this number being large.
 *
 *  SIXTY, not twenty, because twenty was SHORTER THAN THE THING IT WAS MEASURING. The whole budget
 *  is SETTLE + MAX_TRIES * CONVERGE_WAIT = 1500 + 20*400 = 9.5s, and app-sheetview does not render
 *  its FIRST element until ~10s on a cold Vite cache — Univer is an enormous dependency graph and
 *  dev-mode Vite transforms it unbundled on first request. Measured directly: root element count was
 *  0 at 2s, 0 at 4s, 0 at 6s, and 2 at 10s. So the harness reached its verdict before the story had
 *  begun, and whether it caught anything at all was decided by how warm Vite's module cache happened
 *  to be. That is the real source of the app-sheetview flake, and of the 469-vs-538 counts: not a
 *  race inside Univer's plugin registration, which is what I twice concluded and twice got wrong.
 *  Univer mounts identically every time when it is actually given time to finish.
 *
 *  The cost is bounded and falls only where it should. A story that renders genuinely nothing never
 *  counts an empty capture toward stability (see captureOne), so it now burns 25.5s instead of 9.5s
 *  before reporting "rendered 0 elements". That is the correct place to spend it: a blank story is a
 *  defect worth waiting to be sure about, and there should be zero of them in a green sweep. */
const MAX_TRIES = Number(arg('tries', '60'))
/** Frozen wall clock. Any fixed instant works; this one is a Thursday mid-month, so a month grid has
 *  both leading and trailing out-of-month cells and the calendar stories exercise both. */
const FROZEN_NOW = Date.parse('2026-01-15T12:00:00Z')
const UPDATE = has('update')
const OUT = join(import.meta.dir, 'css-baseline.json')
/** Full drift dump on a failing run — generated, gitignored, overwritten every run. */
const DRIFT = join(import.meta.dir, 'css-baseline.drift.txt')
const W = 1280,
    H = 900
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** QUIESCENCE, NOT A COUNTER — see the full reasoning where this used to live, just above the old
 *  browser-level `Network.enable` listener. Moved up here (was declared after PROBE) because POOLING
 *  means quiescence can no longer be read off ONE shared CDP socket: `newPage()`'s events all arrive
 *  on the SAME `session.ws`, undifferentiated by which page they belong to, so a browser-level
 *  `Network.*` listener would attribute one tab's in-flight request to every OTHER tab's convergence
 *  loop the instant a second page exists (see bench/chromeSession.ts's own note on this). Tracking it
 *  IN THE PAGE instead — a `PerformanceObserver` the NET_WATCH script below installs before any story
 *  code runs — sidesteps the multiplexing problem entirely: each page's `window` is its own isolated
 *  world, so `performance.now() - window.__cssbNet.last` measured inside PROBE is automatically
 *  scoped to that one target. NET_QUIET itself (500ms of silence) is unchanged from before pooling. */
const NET_QUIET = 500

/** The properties worth tracking. Deliberately NOT every property: the full computed set is ~340
 *  properties per element, which makes the baseline enormous and full of values no CSS in this repo
 *  ever sets. These are the ones this codebase's rules actually control. */
const PROPS = [
    'display',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'z-index',
    'overflow-x',
    'overflow-y',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'flex-direction',
    'flex-wrap',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'align-items',
    'justify-content',
    'gap',
    'grid-template-columns',
    'grid-template-rows',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-transform',
    'text-align',
    'text-decoration-line',
    'white-space',
    'text-overflow',
    'overflow-wrap',
    'word-break',
    'font-variant-numeric',
    'color',
    'background-color',
    'background-image',
    'opacity',
    'visibility',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-left-radius',
    'border-bottom-right-radius',
    'box-shadow',
    'backdrop-filter',
    'transform',
    'transition-property',
    'transition-duration',
    'cursor',
]

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
  // ANCHOR AT THE STORY ROOT, NOT AT body. Storybook creates four sibling wrappers —
  // .sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-errordisplay — LAZILY and BEFORE
  // #storybook-root in the body. Whether they exist yet depends on what the preview runtime has had
  // to display, so a path keyed from body shifts by one for every wrapper that happens to be present,
  // and EVERY element in the story reports as changed at once: mass "NEW element" plus display/size
  // values swapping between siblings that never moved. That produced 143 phantom diffs across four
  // stories with an empty App.css diff, and it is what the retry pass was quietly papering over.
  // Anchoring here makes the measurement independent of Storybook's own chrome entirely.
  // ROOTS, PLURAL — the story root AND every portal. Anchoring at #storybook-root alone was a
  // regression that hid TWELVE stories completely: every modal (ui-modal, the five app modals,
  // FolderPrompt) and the symbol gallery renders through a Solid <Portal>, which mounts to
  // document.body and therefore OUTSIDE the story root. They measured as 0 elements — silently
  // unprotected, which is strictly worse than the body-keyed aliasing this replaced, because an
  // aliased story at least reports drift while an empty one passes forever.
  //
  // So: enumerate body children, skip the ones Storybook owns, and treat each survivor as a root.
  // That keeps the immunity to Storybook's lazily-created wrappers (the whole point of anchoring)
  // while covering anything the app portals out.
  const SB_IDS = ["storybook-root", "storybook-docs", "storybook-highlights-root"];
  const isChrome = (el) =>
    el.tagName === "SCRIPT" || el.tagName === "STYLE" ||
    (el.id && SB_IDS.indexOf(el.id) >= 0) ||
    /\\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\\b/.test(el.getAttribute("class") || "");

  const storyRoot = document.querySelector("#storybook-root");
  const roots = [];
  if (storyRoot) roots.push(["root", storyRoot]);
  let portalN = 0;
  for (const el of Array.prototype.slice.call(document.body.children)) {
    if (el === storyRoot || isChrome(el)) continue;
    roots.push(["portal[" + portalN++ + "]", el]);
  }
  if (roots.length === 0) roots.push(["root", document.body]);

  const path = (el, rootEl, prefix) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== rootEl && n !== document.documentElement; n = n.parentElement) {
      const i = n.parentElement ? Array.prototype.indexOf.call(n.parentElement.children, n) : 0;
      parts.unshift(n.tagName.toLowerCase() + "[" + i + "]");
    }
    return parts.length ? prefix + ">" + parts.join(">") : prefix;
  };

  const ref = document.createElement("div");
  document.body.appendChild(ref);
  const refCs = getComputedStyle(ref);
  const defaults = {};
  for (const p of PROPS) defaults[p] = refCs.getPropertyValue(p);
  ref.remove();

  const out = {};
  // The story's own subtree only. The reference div stays appended to body above, deliberately: it
  // exists to capture what the GLOBAL cascade resolves to, and measuring it inside the story root
  // would let a story's own styles contaminate the baseline the per-element records are diffed
  // against. (No backticks in this comment: it lives INSIDE a template literal, so one would close
  // the string and take the rest of the probe with it.)
  let count = 0;
  for (const entry of roots) {
    const prefix = entry[0], rootEl = entry[1];
    // The root element itself is recorded too, keyed by the bare prefix. For a portal that element
    // IS the modal's outermost box — the thing carrying the backdrop, the z-index and the sizing —
    // so dropping it would measure a modal's contents while ignoring the modal.
    const list = [rootEl].concat(Array.prototype.slice.call(rootEl.querySelectorAll("*")));
    for (const el of list) {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
      count++;
      const cs = getComputedStyle(el);
      const rec = {};
      for (const p of PROPS) {
        const v = cs.getPropertyValue(p);
        if (v !== defaults[p]) rec[p] = v;
      }
      out[path(el, rootEl, prefix)] = rec;
    }
  }
  // See NET_WATCH below for what populates window.__cssbNet — this is the per-PAGE quiescence read
  // that replaces the old browser-level Network.* listener (see the NET_QUIET comment for why).
  const netLast = (window.__cssbNet && window.__cssbNet.last) || -1e12;
  const netQuiet = (performance.now() - netLast) > ${NET_QUIET};
  return JSON.stringify({ count: count, ref: defaults, els: out, netQuiet: netQuiet });
})()`

/** Installed via Page.addScriptToEvaluateOnNewDocument, so it observes every resource load from the
 *  very first byte of the document — including the one a dynamic import fires before any story code
 *  has run. PerformanceObserver, not the old CDP Network domain: a \`resource\` timing entry is scoped
 *  to the page's OWN window, so it is automatically per-target under pooling with no session-id
 *  filtering required (see the NET_QUIET comment above). performance.now(), not Date.now(): FREEZE
 *  below replaces window.Date, and a frozen clock would make every reading of "how long since the
 *  last request" permanently 0 or permanently huge depending on load order. */
const NET_WATCH = `(() => {
  window.__cssbNet = { last: performance.now() };
  try {
    const po = new PerformanceObserver(() => { window.__cssbNet.last = performance.now(); });
    po.observe({ type: 'resource', buffered: true });
  } catch {}
})()`

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
})()`

const index = await (await fetch(`${BASE}/index.json`)).json()
// --story takes an exact id OR a PREFIX. Exact-only was a footgun: story ids are
// "<component>--<case>", so the natural thing to type for a component — `--story shell-windowcontrols`
// — matched nothing and threw, and the per-component workflow this harness is used for is exactly
// "record every case of the thing I just changed". Prefix matching makes that one command. The
// matched set is always printed, because a filter that silently covers more than you meant is worse
// than one that covers less.
/**
 * Stories whose OWN rendering is nondeterministic, so no amount of waiting makes them comparable.
 *
 * `app-sheetview--*` — Univer. This entry has now been added, removed, and added again, so the
 * evidence is written out in full to stop the next reader (or the next me) re-litigating it.
 *
 * WHAT IS NOT WRONG, each ruled out by direct measurement rather than argument:
 *   - The component. Calling `mountSheet()` by hand in the page produces a complete spreadsheet —
 *     553 elements, 3 canvases, 44 toolbar buttons, no console errors — every time it is tried.
 *   - Container width / responsive toolbar collapse. Width is 1280 with no scrollbar on 8/8 runs,
 *     and the toolbar renders 25 header spans and 43 buttons identically on every one.
 *   - The frozen Date this harness installs. A/B tested: unfrozen loads stall exactly as often.
 *   - The harness budget. SETTLE + MAX_TRIES*CONVERGE_WAIT was once 9.5s, shorter than the story's
 *     ~10s cold first render; MAX_TRIES is now 60 (25.5s) and the stall is unchanged.
 *   - Where the harness starts looking. Probing from 400ms instead of 1500ms was tried and reverted:
 *     it changed nothing here and put every other story's baseline at risk.
 *
 * WHAT IS ACTUALLY WRONG: the mount is bistable across page loads in a way nothing in this repo
 * controls. The identical probe reached the full 538 elements on three consecutive loads and stalled
 * at 2 elements on five consecutive loads later the same session, with no code change between them
 * and the dev server serving 200 for both the iframe and the module. Univer is an enormous dependency
 * graph that Vite serves unbundled in dev, and the stall is in getting that graph into the page, not
 * in Univer's own rendering. A production build would very likely not show it — which is precisely
 * why it does not belong in a gate that runs against the dev server.
 *
 * THE COST IS REAL AND IS NOT HIDDEN: these two stories have NO automated visual-regression cover.
 * That is the trade — a gate that fails on something nobody changed teaches its reader to dismiss red
 * runs, and a dismissed gate protects nothing. The exclusion is ANNOUNCED on every run, and
 * `--story app-sheetview` still checks them by hand.
 *
 * BEFORE ADDING ANOTHER ID HERE: measure the story's time-to-first-element and confirm the harness
 * budget exceeds it, and confirm the component renders when invoked directly. "I already fixed three
 * things in the harness" is not evidence; fixes are not measurements.
 */
// `app-terminal--drop-affordance-before-font-load` deliberately monkeypatches `document.fonts.load`
// to stay pending forever (see Terminal.stories.tsx's `installPendingFontLoad`) — the story only
// resolves it from inside its own `play()`, which this harness never runs (`bun run play` is the
// only tool that does). So every capture here is frozen in Terminal's pre-mount state, at the mercy
// of whatever that DOM happens to be mid-render — not a rendering result any component author
// controls, and not something a css-baseline diff can usefully assert about.
const UNSTABLE: string[] = [
    'app-sheetview--default',
    'app-sheetview--empty',
    'app-terminal--drop-affordance-before-font-load',
]

const matchesOnly = (id: string) => !ONLY || id === ONLY || id.startsWith(ONLY)
/** An excluded story is skipped unless it is named EXACTLY.
 *
 *  "Exactly", not "matched by a prefix", and the difference is not pedantic: `--update --story app-`
 *  prefix-matches `app-sheetview--default`, and re-recorded both sheetview baselines from 581 element
 *  records down to 3 — a mid-mount capture written straight over the good data the exclusion list
 *  exists to park. The intent of letting `--story` reach an excluded story is a DELIBERATE manual
 *  check of that story; typing a broad prefix is not that, and under `--update` it is destructive.
 *  Naming the id in full still works, so nothing an author actually meant to do is blocked. */
const excluded = (id: string) => UNSTABLE.indexOf(id) >= 0 && id !== ONLY
const storyIds = Object.keys(index.entries)
    .filter(id => matchesOnly(id) && !excluded(id))
    .sort()
if (storyIds.length === 0)
    throw new Error(`no stories matched (--story ${ONLY})`)
if (!ONLY && UNSTABLE.length) {
    console.error(
        `NOT PROTECTED: ${UNSTABLE.length} story(s) excluded as nondeterministic — a regression in these ` +
            `will NOT be caught here:\n  ${UNSTABLE.join('\n  ')}`,
    )
}
if (ONLY)
    console.error(
        `--story ${ONLY} matched ${storyIds.length}: ${storyIds.join(', ')}`,
    )

// Launch, port poll, CDP attach and teardown are chromeSession.ts's — including the SIGKILL-then-retry
// profile delete that this harness needed after leaking 20 profiles / 600 MB, and which two sibling
// tools each got wrong in their own way before it was shared.
//
// `--force-prefers-reduced-motion` is passed explicitly, not defaulted in the helper: visual.ts must
// NOT have it, because its readiness loop waits for animation to settle.
// SESSION IS MUTABLE so a dead browser can be REPLACED mid-sweep rather than ending the run.
// Chrome's renderer gets killed under memory pressure — the CDP call then rejects with "Session with
// given id not found" — and this sweep is 600+ stories long. Aborting was the original behaviour and
// it is defensible (a half-finished run must never be mistaken for a pass), but in practice it threw
// away 20+ minutes of work three times in one session for a fault that has nothing to do with the
// code under test. Relaunching and retrying the story preserves the real invariant — the run still
// covers every story or fails loudly — while surviving something outside its control.
const LAUNCH_OPTS = {
    label: 'cssbase',
    width: W,
    height: H,
    flags: ['--force-prefers-reduced-motion'],
}
let session = await launchChrome(LAUNCH_OPTS)

/** True for the two ways a browser announces it is gone. Anything else is a real protocol error and
 *  must NOT be swallowed as a transient — retrying a genuine bug forever would turn a loud failure
 *  into a hang, which is the trade this whole file has been fixing all session. */
const isDeadSession = (e: unknown) => {
    const m = String((e as Error)?.message ?? '')
    return (
        m.includes('Session with given id not found') ||
        m.includes('Target closed') ||
        m.includes('stopped answering')
    )
}

/** One fully-configured target: fixed viewport at scale 1, pinned timezone, frozen clock (see
 *  DETERMINISM above) and the NET_WATCH quiescence probe. PER-TOOL, deliberately not folded into
 *  chromeSession.ts's helper — visual.ts renders at scale 2 and needs real time, so none of the
 *  style-reading tools' setup can be a shared default there.
 *
 *  ONE CALL PER POOL SLOT, not once per browser: every setting below is target-scoped (CDP methods
 *  attach to a session, not the browser as a whole), which is exactly what makes pooling possible —
 *  each of the CONCURRENCY pages gets its own independently-configured target. `newPage()` itself
 *  already applies the two subtler per-target fixes a pooled tab needs to paint at all
 *  (`Page.setWebLifecycleState` + `Emulation.setFocusEmulationEnabled` — see chromeSession.ts) so
 *  this harness gets those for free. */
const preparePage = async (): Promise<Cdp> => {
    const p = await session.newPage()
    await p('Emulation.setDeviceMetricsOverride', {
        width: W,
        height: H,
        deviceScaleFactor: 1,
        mobile: false,
    })
    // UTC, not the host zone: a calendar rendering local dates would otherwise shift with whoever runs it.
    await p('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
    await p('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE })
    await p('Page.addScriptToEvaluateOnNewDocument', { source: NET_WATCH })
    return p
}

/** Replace the whole browser — used only when the browser itself, not just one target, is gone
 *  (`session.newPage()` rejects). SHARED across every worker via one cached promise: with
 *  CONCURRENCY pages on a single browser process, a real crash takes all of them out in the same
 *  tick, and without this cache every worker would independently relaunch its own Chrome —
 *  CONCURRENCY browsers doing the work of one, and every relaunch after the first leaking a profile
 *  the SIGKILL-then-retry teardown never gets a clean chance to run for. */
let relaunching: Promise<void> | null = null
const relaunchBrowser = (why: string): Promise<void> => {
    if (!relaunching) {
        process.stderr.write(`\n  browser died (${why}) — relaunching\n`)
        relaunching = (async () => {
            try {
                session.close()
            } catch {
                /* already gone; the point is to not leak the profile */
            }
            session = await launchChrome(LAUNCH_OPTS)
        })().finally(() => {
            relaunching = null
        })
    }
    return relaunching
}

/** A worker's target died (isDeadSession). Try the cheap recovery first — a fresh target on the SAME
 *  browser, which is all a single crashed renderer needs — and only fall back to replacing the whole
 *  browser when that itself fails, meaning the browser process is the thing that is actually gone.
 *  `id` is the story in flight when the target died, threaded through solely so a DOUBLE failure
 *  (browser relaunches and the fresh target still won't come up) rethrows with the same story-id
 *  prefix every other fatal error in this file uses (see the `CDP died on "${id}"` throw below) —
 *  without it this was the one failure path in the sweep that surfaced as a bare, unattributed
 *  protocol error. */
const recoverPage = async (id: string): Promise<Cdp> => {
    try {
        return await preparePage()
    } catch (e) {
        await relaunchBrowser((e as Error).message.slice(0, 60))
        try {
            return await preparePage()
        } catch (e2) {
            throw new Error(
                `${id}: recoverPage failed twice — browser relaunch did not recover a working target: ${(e2 as Error).message}`,
            )
        }
    }
}

const captured: Record<string, any> = {}
const empty: string[] = []
// Progress goes to stderr every story. A full run holds the terminal for minutes with nothing to
// show, which reads as a hang — and any supervisor watching the stream (a subagent watchdog, CI's
// no-output timeout) will kill it on exactly that silence. \r keeps it to one line interactively.
const unstable: string[] = []
/** Stories whose target had to be replaced mid-run — a single crashed renderer or a whole dead
 *  browser, reported the same way. Reported at the end: a sweep that survived some renderer deaths is
 *  still a valid sweep, but the reader should know the machine was struggling rather than be shown an
 *  unqualified green. */
const recovered: string[] = []

/** Probe the CURRENTLY-LOADED page until it stops changing, then return the capture.
 *
 *  CONVERGENCE PROVES STABILITY, NOT COMPLETENESS, and that distinction cost a false alarm. Univer
 *  (app-sheetview) and Milkdown (app-blockeditor) mount in stages, and under CPU contention a stage
 *  can PLATEAU for longer than the stability window — so three identical captures in a row are a real
 *  measurement of a half-mounted component. The full run reported 2727 REMOVED elements across those
 *  stories with no warning, while re-checking each in isolation gave `0 changed`. Hence the
 *  drift-retry pass below: a plateau is broken by re-loading the story on its own, and a real
 *  regression survives that. */
const captureOne = async (
    p: Cdp,
    id: string,
    settle: number,
    wait: number,
) => {
    await sleep(settle)
    // `grew` escalates the stability requirement for staged mounters ONLY, so the ~250 stories that
    // render in one shot pay nothing for Univer's benefit. See the growth note at the break below.
    let last = '',
        value = '',
        same = 0,
        maxCount = 0,
        grew = false,
        need = STABLE
    for (let i = 0; i < MAX_TRIES; i++) {
        const r = await p('Runtime.evaluate', {
            expression: PROBE,
            returnByValue: true,
            awaitPromise: true,
        })
        if (r.exceptionDetails) {
            console.error(`\nSKIP ${id}: ${r.exceptionDetails.text}`)
            return null
        }
        value = r.result.value
        // AN EMPTY STORY ROOT IS NEVER "SETTLED". This is the completeness hole, and it is not subtle
        // once measured: ui-markdownfield--placeholder renders ZERO elements until ~2000ms, because
        // Milkdown mounts asynchronously. The default 800ms settle plus three 350ms convergence waits
        // reaches a verdict at ~1850ms, and three consecutive captures of an empty root are perfectly
        // identical — so the harness recorded "this story has no elements" and moved on, having proved
        // only that nothing had started yet. The check pass then saw the real component and reported
        // every element as NEW. Refusing to count an empty capture toward stability costs nothing on the
        // 258 stories that mount promptly (their first capture is already non-empty) and gives the slow
        // ones the full MAX_TRIES budget. A story that genuinely renders nothing still exits the loop
        // unsettled and is reported by the "rendered 0 elements" warning below, which is where a truly
        // blank story SHOULD surface — loudly, not as a silently blessed recording.
        const count = Number(/"count":(\d+)/.exec(value)?.[1] ?? 0)
        // A STORY THAT GREW WHILE WE WATCHED IS A STAGED MOUNTER, AND STAGED MOUNTERS LIE AT REST.
        // app-sheetview goes 3 elements -> 469 -> 538 as Univer registers its plugins. Each step holds
        // still, so a plain "N identical captures" test can accept 469 and record a spreadsheet with no
        // toolbar. Chasing this with a bigger fixed window costs every fast story the same delay; keying
        // it to observed GROWTH costs only the stories that actually stage. Once a story has grown even
        // once, it must then hold still for three extra probes before it is believed.
        //
        // This is what I initially misdiagnosed as Univer being nondeterministic and nearly dropped from
        // the gate. It is not: probed six times at a flat 4s wait it produced 538 elements and 36 toolbar
        // buttons every single time. The variance was entirely this early break.
        // Growth means the count rose from a PREVIOUSLY OBSERVED value — including from zero, which
        // the old `if (maxCount > 0)` rule ignored and which is exactly the async-mounter case that
        // needs the longer window. Zero IS a stage: it is the stage before the component exists.
        //
        // `i > 0` is load-bearing and its absence was measured. Without it the FIRST capture always
        // satisfies `count > maxCount` (maxCount starts at 0), so every non-empty story is branded a
        // staged mounter and pays STABLE + 3 instead of STABLE — about +1.2s x 427 stories, roughly
        // +8 minutes of sweep, for nothing. The first capture has no predecessor and therefore cannot
        // demonstrate growth; it only establishes the baseline the later probes are compared against.
        if (i > 0 && count > maxCount) grew = true
        if (count > maxCount) maxCount = count
        need = grew ? STABLE + 3 : STABLE
        // `netQuiet` now travels INSIDE `value` (see PROBE/NET_WATCH above) rather than through a
        // browser-level listener — pooling means quiescence has to be read per-PAGE, not per-browser
        // (see the NET_QUIET comment). Pulled out with a regex before JSON.parse, the same way `count`
        // already is: a network blip that changes nothing else in `value` still needs to break the
        // identical-capture streak, exactly as it did before pooling.
        const netQuiet = /"netQuiet":(true|false)/.exec(value)?.[1] === 'true'
        // `inflight <= 0` is part of the settle condition, not a separate wait: a story can be visually
        // still purely because the thing that will change it has not been delivered yet.
        same = value === last && count > 0 && netQuiet ? same + 1 : 0
        last = value
        if (same >= need - 1) break
        await sleep(wait)
    }
    const parsed = JSON.parse(value)
    return {
        ref: parsed.ref,
        els: parsed.els,
        count: parsed.count as number,
        settled: same >= need - 1,
    }
}

const PROGRESS_FILE = '/tmp/bismuth-bench.progress'
// Start time goes in the beacon so a reader can derive an ETA from MEASURED throughput rather than a
// guessed per-story constant. Throughput here is not constant — a story mounting Univer costs many
// times one rendering a status dot — so an ETA from "stories done so far / elapsed" self-corrects as
// the run proceeds, which a fixed estimate cannot.
const BEACON_START = Date.now()
const beacon = (label: string, n: number, total: number) => {
    try {
        writeFileSync(PROGRESS_FILE, `${label} ${n} ${total} ${BEACON_START}`)
    } catch {
        /* a status line is a nicety; never let it break a run */
    }
}

/* Index-based pool, the same shape playCheck.ts and storyAudit.ts already use: CONCURRENCY prepared
   targets, each pulling the next index until the list is exhausted. `pages[i]` is kept up to date by
   its own worker (not just read once at pool-creation time) so that after a per-target recovery the
   DRIFT-RETRY PASS below — which runs after every worker has finished — can reuse a page that is
   actually still alive, rather than the possibly-dead one the pool started with. */
const pages: Cdp[] = await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, storyIds.length) }, preparePage),
)
let next = 0
let done = 0
/* A genuine (non-dead-session) CDP error is fatal — "a half-finished run must not be mistaken for a
   pass" — but with several workers in flight, throwing straight out of one would leave the others
   running unobserved and their rejections unhandled. Instead a worker records the error and returns;
   every worker checks it before claiming its next story, so the pool drains promptly, and it is
   rethrown once after `Promise.all` settles. */
let fatalError: Error | null = null
const worker = async (idx: number) => {
    let p = pages[idx]!
    for (;;) {
        if (fatalError) return
        const i = next++
        if (i >= storyIds.length) return
        const id = storyIds[i]!
        let got: Awaited<ReturnType<typeof captureOne>> = null
        // One retry, after replacing this worker's target. Not a loop: if a FRESH target dies on the
        // same story immediately, the story itself is killing the renderer and retrying forever would
        // hide that behind an eternally-running sweep.
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await p('Page.navigate', {
                    url: `${BASE}/iframe.html?id=${id}&viewMode=story`,
                })
                got = await captureOne(p, id, SETTLE, CONVERGE_WAIT)
                break
            } catch (e) {
                if (attempt === 0 && isDeadSession(e)) {
                    recovered.push(id)
                    p = await recoverPage(id)
                    pages[idx] = p
                    continue
                }
                // A CDP call can reject outright — "Session with given id not found" when the renderer
                // falls over, which happened once at story 185 of 247 under memory pressure from a
                // second browser. Left unhandled that surfaces as a raw protocol error with a stack
                // pointing at the RPC helper and NO indication of which story was in flight, which is
                // the least useful possible failure. Name the story, then fail the whole sweep.
                fatalError = new Error(
                    `CDP died on "${id}" (story ${done + 1}/${storyIds.length}): ${(e as Error).message}`,
                )
                return
            }
        }
        done++
        beacon(UPDATE ? 'record' : 'gate', done, storyIds.length)
        process.stderr.write(
            `\r[${done}/${storyIds.length}] ${id.slice(0, 60).padEnd(60)}`,
        )
        if (!got) continue
        if (!got.settled) unstable.push(id)
        if (got.count === 0) empty.push(id)
        captured[id] = { ref: got.ref, els: got.els }
    }
}
await Promise.all(pages.map((_, idx) => worker(idx)))
process.stderr.write('\n')
if (fatalError) throw fatalError
// The browser is NOT released here. It was, until the drift-retry pass below needed to re-load a
// story — and closing first turned every retry into a dead-session catch that silently kept the
// first-pass verdict. close() is idempotent and registered on process exit; the explicit call now sits
// after the retry.

if (recovered.length)
    console.error(
        `NOTE: the browser died and was replaced ${recovered.length} time(s) — the machine is under memory pressure. Stories affected: ${recovered.join(', ')}`,
    )
if (empty.length)
    console.error(
        `WARNING: ${empty.length} story(s) rendered 0 elements — unprotected:\n  ${empty.join('\n  ')}`,
    )
if (unstable.length)
    console.error(
        `WARNING: ${unstable.length} story(s) never converged in ${MAX_TRIES} probes — their values are arbitrary and will flake:\n  ${unstable.join('\n  ')}`,
    )

if (UPDATE) {
    // A partial re-record (--update --story <id>) must MERGE, not replace: writing `captured` whole
    // would silently wipe the snapshot for the other 239 stories, and re-recording just the story a
    // task touched is the natural per-task workflow. Full --update still replaces everything, so a
    // story deleted from Storybook drops out of the baseline the way it should — but a story merely
    // EXCLUDED from the sweep (UNSTABLE) is carried forward, not deleted; see below.
    let next = captured
    if (existsSync(OUT)) {
        const prev = JSON.parse(readFileSync(OUT, 'utf8'))
        if (ONLY) next = { ...prev, ...captured }
        else {
            // A BARE SWEEP MUST STILL CARRY EXCLUDED STORIES FORWARD. Dropping ids that no longer
            // exist in Storybook is the intent, but `captured` also omits every id in UNSTABLE,
            // which the sweep never visits — so a plain `--update` used to DELETE exactly the
            // baselines the exclusion list is meant to park. Measured: a full update took the file
            // from 427 entries to 425, silently discarding both app-sheetview recordings (581
            // element records each) that `--story app-sheetview` had deliberately preserved.
            // Keying the carry-forward off the live Storybook index keeps the delete-on-removal
            // behaviour intact: an id gone from the index is still dropped.
            const live = new Set(Object.keys(index.entries))
            const carried: Record<string, unknown> = {}
            for (const id of Object.keys(prev))
                if (!(id in captured) && live.has(id)) carried[id] = prev[id]
            if (Object.keys(carried).length)
                console.error(
                    `carried forward ${Object.keys(carried).length} excluded story(s) not visited by this sweep:\n  ${Object.keys(carried).join('\n  ')}`,
                )
            next = { ...carried, ...captured }
        }
    }
    // SORTED BY STORY ID, not insertion order. `captured`'s own keys land in whatever order the pool
    // happened to finish each story in — nondeterministic run to run now that stories complete out of
    // order — and `JSON.stringify` on a plain object walks keys in insertion order, so writing `next`
    // as-is would reorder the file on every re-record with no value actually different. A reordered
    // baseline is a diff nobody asked for and a `git blame` that lies about what changed.
    const sortedNext: Record<string, unknown> = {}
    for (const id of Object.keys(next).sort()) sortedNext[id] = next[id]
    writeFileSync(OUT, JSON.stringify(sortedNext, null, 1))
    console.log(
        `recorded ${Object.keys(captured).length} stories -> ${OUT} (${Object.keys(next).length} total)`,
    )
    process.exit(0)
}

if (!existsSync(OUT))
    throw new Error(`no baseline at ${OUT} — run with --update first`)
const base = JSON.parse(readFileSync(OUT, 'utf8'))
const diffs: string[] = []
// Entries are DEVIATIONS-FROM-`ref` (see PROBE), so a property absent from an entry does NOT mean
// "unchanged" — it means "whatever this run's reference resolved to". Comparing the stored keys
// directly would let a global inherited rule vanish from both the element and the reference at once
// and read as no drift. So resolve every property on both sides against ITS OWN recorded reference
// first, and walk the full PROPS list rather than only the keys that happen to be present.
const resolve = (
    rec: Record<string, string> | undefined,
    ref: Record<string, string>,
    prop: string,
) => rec?.[prop] ?? ref[prop] ?? '[absent]'
/** All drift lines for ONE story, or [] if it matches. Pure, so the retry pass can reuse it. */
const diffStory = (
    id: string,
    c: { ref: Record<string, string>; els: Record<string, any> },
): string[] => {
    const out: string[] = []
    const b = base[id]
    if (!b) return [`${id}: NEW story (no baseline)`]
    if (!b.ref || !b.els)
        throw new Error(
            `baseline story "${id}" predates the recorded-reference schema — re-record with --update`,
        )
    const bRef = b.ref as Record<string, string>,
        cRef = c.ref
    // Reference drift is reported in its own right: it is the app-wide signal, and without it a
    // dropped global rule reads only as a wall of per-element lines with no stated cause.
    for (const prop of PROPS) {
        if (bRef[prop] !== cRef[prop])
            out.push(
                `${id} [reference] ${prop}: ${bRef[prop] ?? '[absent]'} -> ${cRef[prop] ?? '[absent]'}`,
            )
    }
    const allPaths = new Set([...Object.keys(b.els), ...Object.keys(c.els)])
    for (const p of allPaths) {
        const bp = b.els[p],
            cp = c.els[p]
        if (!bp) {
            out.push(`${id} ${p}: NEW element`)
            continue
        }
        if (!cp) {
            out.push(`${id} ${p}: REMOVED element`)
            continue
        }
        for (const prop of PROPS) {
            const bv = resolve(bp, bRef, prop)
            const cv = resolve(cp, cRef, prop)
            if (bv !== cv) out.push(`${id} ${p} ${prop}: ${bv} -> ${cv}`)
        }
    }
    return out
}

const perStory = new Map<string, string[]>()
// storyIds, not Object.keys(captured): the pool completes stories out of order, so captured's own
// key order is nondeterministic run to run — walking storyIds (sorted at definition) keeps the
// printed diff and the drift file in a stable, reviewable order regardless of completion order.
for (const id of storyIds) if (id in captured) perStory.set(id, diffStory(id, captured[id]))

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
const RETRY_CAP = Math.max(8, Math.floor(storyIds.length / 4))
const drifted = [...perStory].filter(([, d]) => d.length).map(([id]) => id)
if (drifted.length > RETRY_CAP && !UPDATE) {
    process.stderr.write(
        `${drifted.length} of ${storyIds.length} stories drifted — above the ${RETRY_CAP} retry cap, so this reads as an intended app-wide change, not contention. Reporting the first pass as-is.\n`,
    )
} else if (drifted.length && !UPDATE) {
    process.stderr.write(
        `re-checking ${drifted.length} drifted story(s) in isolation before reporting…\n`,
    )
    // ONE page, not the whole pool — mirrors storyAudit.ts's serial empty-render recheck. `pages[0]`
    // rather than a freshly-captured `session.page`: it is kept live by `worker()` writing back into
    // `pages` on every per-target recovery, so this reuses whichever target is actually still alive
    // rather than the one the pool started with.
    const retryPage = pages[0]!
    for (const id of drifted) {
        try {
            await retryPage('Page.navigate', {
                url: `${BASE}/iframe.html?id=${id}&viewMode=story`,
            })
        } catch {
            // Session gone. Keep the first-pass verdict rather than silently passing — but SAY so,
            // because the remaining stories in this loop are now un-retried and a reader would
            // otherwise assume every drifted story got its second chance.
            process.stderr.write(
                `  browser died during retry — the stories after ${id} keep their first-pass verdict\n`,
            )
            break
        }
        const again = await captureOne(retryPage, id, SETTLE * 2, CONVERGE_WAIT * 2)
        if (!again) continue
        const d2 = diffStory(id, again)
        // ALWAYS report the outcome, not just an improvement. Printing only when the retry helped
        // makes "retried and it did not help" look identical to "never retried" — which cost real
        // diagnosis time: a run reported 5 stories re-checked, printed nothing, and the natural
        // reading was that the retry pass had silently failed. It had run and found the same drift.
        // A verification step that stays quiet when it changes nothing is unreadable by design.
        const was = perStory.get(id)!.length
        process.stderr.write(
            d2.length < was
                ? `  ${id}: ${was} -> ${d2.length} on retry\n`
                : d2.length === was
                  ? `  ${id}: ${was} unchanged on retry — drift is REAL, not contention\n`
                  : `  ${id}: ${was} -> ${d2.length} on retry (WORSE — the story is unstable)\n`,
        )
        perStory.set(id, d2)
        if (d2.length === 0) captured[id] = { ref: again.ref, els: again.els }
    }
}
for (const d of perStory.values()) diffs.push(...d)
session.close()
// A story whose probe threw was logged SKIP and never landed in `captured`. Iterating only the
// captured side would let it drop out of the comparison entirely with the exit code still 0 — the
// story-level version of the same union rule applied to properties above.
for (const id of Object.keys(base)) {
    // `excluded` as well as `matchesOnly`: this loop walks the RECORDED side, so an excluded story is
    // still sitting in the baseline file and would otherwise be reported here as vanished-from-the-run.
    if (!matchesOnly(id) || excluded(id)) continue
    if (!(id in captured))
        diffs.push(`${id}: MISSING from capture (story errored or was removed)`)
}
console.log(diffs.slice(0, 200).join('\n'))
if (diffs.length > 200) console.log(`… and ${diffs.length - 200} more`)
// The terminal cap is for readability, but the truncated remainder is where a real regression hides
// inside an expected-looking diff: an intentional app-wide change (a font swap, a white-space rule
// on every icon) easily produces four figures of drift, and reviewing only the first 200 lines means
// grading the change by its most boring rows. Always write the FULL list somewhere greppable.
if (diffs.length) {
    writeFileSync(DRIFT, diffs.join('\n') + '\n')
    console.log(`full diff -> ${DRIFT}`)
} else {
    // A clean run must DELETE the dump, not just decline to write one. Leaving the previous failing
    // run's file on disk means the next reader greps a stale drift list against a passing run and
    // believes it — the exact confusion this file exists to prevent.
    try {
        rmSync(DRIFT, { force: true })
    } catch {}
}
console.log(`${diffs.length} changed`)
process.exit(diffs.length === 0 ? 0 : 1)
