/**
 * bench/invariants.ts — visual checks that DO NOT need a baseline.
 *
 * WHY THIS EXISTS, next to cssBaseline.ts rather than replacing it. The baseline gate records the
 * exact computed value of every property on every element, which makes it maximally sensitive: it
 * cannot tell a deliberate restyle from a regression, so ANY design change costs a full re-record of
 * all 427 stories (~33 minutes) and a human reading ~1,100 diffs to bless them. That is the wrong
 * instrument for a codebase being actively restyled, and its absolute-pixel recordings are also what
 * let a story captured mid-mount become a "valid" baseline (graph stories once recorded 1 element
 * where they render 32).
 *
 * These checks assert PROPERTIES THAT HOLD REGARDLESS OF DESIGN. Change a colour, a size, a spacing
 * scale — they still pass. They only fire on things that are wrong under any design:
 * unreadably small text, invisible text, a control with no hit area, content escaping its container,
 * a font-size off the project's own type scale. Nothing to re-record, so they can run on every commit
 * and stay meaningful while the design moves.
 *
 * Usage:
 *   bun bench/invariants.ts                 # every story
 *   bun bench/invariants.ts --story ui-     # a prefix
 *   bun bench/invariants.ts --json          # machine-readable
 */
import { launchChrome } from './chromeSession'

const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
        ? process.argv[i + 1]!
        : d
}
const has = (n: string) => process.argv.includes(`--${n}`)

const BASE = arg('base', 'http://localhost:6006')
const ONLY = arg('story')
const W = Number(arg('width', '1280'))
const H = Number(arg('height', '900'))
/** Upper bound on how long to wait for a story to put SOMETHING on the page, and the quiet period
 *  after it does. Not a fixed settle: a fixed sleep is a guess that is simultaneously too long for
 *  the 400 stories that mount instantly and too short for a cold start, where the first load pays for
 *  Vite's module graph and the webfonts. Measured: on a fresh Chrome profile a story that renders in
 *  ~300ms warm shows ZERO elements at 3.5s cold — which a fixed settle records as "renders nothing".
 *  Polling until the root is non-empty costs the fast stories nothing and lets the slow ones finish. */
const READY_TIMEOUT = Number(arg('ready-timeout', '6000'))
const QUIET_AFTER_FIRST_PAINT = Number(arg('settle', '400'))
/** How many stories to check at once, in ONE Chrome with N tabs.
 *
 *  Parallel because the work is almost entirely waiting on page loads, which overlaps nearly for
 *  free; sequential is why the older snapshot sweep takes ~30 minutes for 427 stories and therefore
 *  stopped being run. Six, not thirty: concurrent pages compete for CPU, and a story starved of CPU
 *  mounts LATER, which is exactly the condition that produced mid-mount captures in the snapshot
 *  gate. A modest pool keeps the speedup without manufacturing that failure. Override with
 *  --concurrency if a machine wants more. */
const CONCURRENCY = Number(arg('concurrency', '6'))

/** The project's type scale (ui/ui.css --fs-*). A size off this list is drift, not a decision —
 *  every value here was reconciled against the scale in the 2026-08 standardization pass. */
const SCALE = [10.5, 11.5, 13, 13.5, 15, 19, 24]
/** Sizes deliberately off the scale, with the reason. Anything not listed is reported. */
const SCALE_EXEMPT = new Set([
    17, 21, 22, 26, 30, 34, 38, 40, 48, // display/hero type in intro + note titles
    // ── The PROSE scale (2026-08-29) ─────────────────────────────────────────────────────────
    // SCALE above is the MONO chrome scale (ui/ui.css --fs-*). Note prose and chat message bodies
    // are the one surface that is deliberately not on it — the settings schema says so directly:
    // "prose is the one thing that is NOT at the 11.5px --fs-ui chrome size, because chrome is
    // scanned and prose is read". Since prose moved to the proportional face it also carries an
    // optical-size correction (styles/tokens.css --prose-scale, 1.25), so its sizes are derived
    // rather than picked off a ladder:
    16.88, // --prose-font-size: --editor-font-size (13.5) x --prose-scale (1.25)
    14.85, // .bismuth-tag, sized in em RELATIVE to prose (0.88em) so tags track the body face
])

const CHECKS = `(() => {
    // MEASURE THE PORTALS TOO, NOT JUST THE STORY ROOT. Modals, popovers and the symbol gallery
    // render into a sibling of #storybook-root, so a checker anchored only at the root sees an empty
    // page and calls the story blank — five ui- stories (both modals, three galleries) reported
    // "rendered nothing" for exactly this reason while rendering perfectly. cssBaseline.ts already
    // learned this; the same fix belongs here.
    const SB_IDS = ['storybook-root', 'storybook-docs', 'storybook-highlights-root']
    const isChrome = el =>
        el.tagName === 'SCRIPT' || el.tagName === 'STYLE' ||
        (el.id && SB_IDS.indexOf(el.id) >= 0) ||
        /\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\b/.test(el.getAttribute('class') || '')
    const storyRoot = document.querySelector('#storybook-root')
    if (!storyRoot) return JSON.stringify({ fatal: 'no #storybook-root' })
    const roots = [storyRoot]
    for (const el of Array.prototype.slice.call(document.body.children))
        if (el !== storyRoot && !isChrome(el)) roots.push(el)

    const out = []
    const add = (rule, detail, el) => {
        let path = el.tagName.toLowerCase()
        const c = (el.getAttribute('class') || '').trim().split(/\\s+/)[0]
        if (c) path += '.' + c
        out.push({ rule, detail, path })
    }
    const vis = el => {
        if (!el.checkVisibility) return true
        return el.checkVisibility({ checkVisibilityCSS: true })
    }
    /** Does this element render TYPOGRAPHY — prose a reader reads — as opposed to a glyph?
     *
     *  An icon holder is not typography, and the type scale does not govern it. Lucide icons are
     *  sized in px through font-size, and a caret/chevron is a single character, so both look exactly
     *  like "text at an off-scale size" to a naive check: search-bar-lead at 14px, ui-select-caret at
     *  12px, pane-header-icon at 11px, ft-icon at 14px, propset-chev at 11px were all reported as
     *  drift. They are icon dimensions, and snapping them to a TEXT scale would resize the icons.
     *
     *  So: an element holding an <svg> is a glyph holder, and so is one whose entire text is one or
     *  two characters (▸ ✎ × ⌄). Real labels are longer than that.
     *
     *  An SVG <text> node is the same case one level deeper. The Phosphor icon migration
     *  (2026-08-27) draws two hand-authored marks (Regex's ".*", WholeWord's "[W]") as inline SVG
     *  <text>, sized against the icon's 256-unit viewBox (font-size 84-120) rather than the type
     *  scale — the SVG's own scale-to-fit is what makes it read at 14px, same as every path-based
     *  icon next to it. That is vector icon content, not prose a reader reads, so it gets the same
     *  exemption a querySelector('svg') ancestor gets — checking closest('svg') rather than
     *  tagName === 'text' so a future <tspan> or nested group is covered the same way. */
    const hasText = el => {
        if (el.querySelector('svg')) return false
        if (el.closest && el.closest('svg')) return false
        let t = ''
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
        t = t.trim()
        return t.length > 2
    }

    // THIRD-PARTY EDITOR AND TERMINAL DOM IS NOT OUR UI. CodeMirror, Milkdown/ProseMirror and xterm
    // build their own element trees with their own em-derived sizing; flagging those reports drift we
    // neither own nor can fix from a stylesheet, and 300 unfixable findings is how a check gets
    // ignored. The WRAPPERS we style are still checked — only the library's internals are skipped.
    const FOREIGN = '.cm-editor, .ProseMirror, .milkdown, .xterm, .univer-container, .bismuth-sheet'
    const inForeign = el => !!el.closest(FOREIGN)
    const all = []
    for (const r of roots)
        for (const el of Array.prototype.slice.call(r.querySelectorAll('*')))
            if (!inForeign(el)) all.push(el)
    const seenSize = new Set()
    for (const el of all) {
        if (!vis(el)) continue
        const cs = getComputedStyle(el)
        const box = el.getBoundingClientRect()

        // 1. TEXT TOO SMALL TO READ. Under any design, body text below the smallest scale step is a
        //    mistake. Uses the scale's own floor rather than an invented number.
        if (hasText(el)) {
            const fs = parseFloat(cs.fontSize)
            // 10px, not 10.5: --fs-micro IS 10.5, and em-derived values land a hair under it
            // (10.49, 9.98) without being a legibility problem. Below 10 is genuinely too small.
            if (fs && fs < 10) add('text-too-small', cs.fontSize, el)
        }

        // 2. FONT-SIZE OFF THE TYPE SCALE. Survives restyling: change a token's VALUE and this still
        //    passes, because it checks membership of the scale, not a pixel number.
        if (hasText(el)) {
            const fs = Math.round(parseFloat(cs.fontSize) * 100) / 100
            if (fs && !seenSize.has(fs)) {
                seenSize.add(fs)
                const onScale = ${JSON.stringify(SCALE)}.some(s => Math.abs(s - fs) < 0.01)
                const exempt = ${JSON.stringify([...SCALE_EXEMPT])}.some(s => Math.abs(s - fs) < 0.01)
                if (!onScale && !exempt) add('font-size-off-scale', fs + 'px', el)
            }
        }

        // 3. INVISIBLE TEXT — foreground equal to the background it sits on. A real defect under any
        //    palette, and the kind a screenshot review skims past.
        if (hasText(el) && cs.color && cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            if (cs.color === cs.backgroundColor) add('invisible-text', cs.color, el)
        }

        // 4. INTERACTIVE CONTROL WITH NO HIT AREA. A button that renders at 0x0 is unclickable
        //    whatever it looks like.
        const tag = el.tagName.toLowerCase()
        const interactive = tag === 'button' || tag === 'a' || tag === 'input' ||
            tag === 'select' || tag === 'textarea' || el.getAttribute('role') === 'button'
        if (interactive && (box.width < 1 || box.height < 1))
            add('control-no-hit-area', Math.round(box.width) + 'x' + Math.round(box.height), el)

        // 5. ELLIPSIS THAT CANNOT FIRE. \`text-overflow: ellipsis\` silently does nothing on an inline
        //    box, and on a flex child without \`min-width: 0\`. This exact trap is documented in
        //    ui/Label.module.css — it is a correctness bug that looks fine until the text is long.
        if (cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible') {
            const display = cs.display
            const parentIsFlex = el.parentElement &&
                /flex/.test(getComputedStyle(el.parentElement).display)
            if (display === 'inline')
                add('ellipsis-on-inline', 'display:inline ignores text-overflow', el)
            else if (parentIsFlex && cs.minWidth === 'auto' && parseFloat(cs.flexShrink) !== 0)
                add('ellipsis-needs-min-width', 'flex child with min-width:auto', el)
        }
    }

    // 6. CONTENT ESCAPING THE VIEWPORT HORIZONTALLY — reported only when a REAL ELEMENT is past the
    //    right edge, and named. Comparing documentElement.scrollWidth to clientWidth alone was not
    //    actionable: two shell-appframe stories reported 1294 > 1280 while NOTHING had a right edge
    //    beyond 1280, so the number came from a document-level quirk with no offender to fix. A
    //    finding nobody can act on is worse than no finding — it trains the reader to skim.
    const vw = document.documentElement.clientWidth
    for (const el of all) {
        if (!vis(el)) continue
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.right > vw + 1) {
            add('overflows-viewport-x', Math.round(b.right) + 'px > ' + vw + 'px', el)
            break // one per story is enough to act on; the rest are usually the same subtree
        }
    }

    return JSON.stringify({ count: all.length, findings: out })
})()`

const index = await (await fetch(`${BASE}/index.json`)).json()
const ids = Object.keys(index.entries)
    .filter(id => !ONLY || id === ONLY || id.startsWith(ONLY))
    .sort()
if (!ids.length) throw new Error(`no stories matched (--story ${ONLY})`)

const s = await launchChrome({ label: 'invariants', width: W, height: H })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
type Finding = { rule: string; detail: string; path: string; story: string }
const findings: Finding[] = []
const blank: string[] = []

/** Each tab is an independent target and inherits none of the first one's overrides, so the viewport
 *  has to be set per page or some stories would silently be checked at Chrome's default metrics.
 *
 *  NO TIMEZONE OVERRIDE HERE, deliberately. `Emulation.setTimezoneOverride` breaks rendering on every
 *  page after the first: measured side by side, an otherwise identical page renders 34 elements
 *  without it and 0 with it, at 3.5s. It reports no error, and `document.visibilityState` stays
 *  "visible" throughout, so the page looks healthy while painting nothing — the same shape as the
 *  mid-mount captures that corrupted the snapshot baseline. cssBaseline.ts can keep its override
 *  because it drives a single page; a parallel runner cannot.
 *
 *  Nothing here depends on the clock: these checks read sizes, colours and layout, so a story
 *  rendering a local date instead of a UTC one cannot change any verdict. */
const preparePage = async (p: Awaited<ReturnType<typeof s.newPage>>) => {
    await p('Emulation.setDeviceMetricsOverride', {
        width: W, height: H, deviceScaleFactor: 1, mobile: false,
    })
    return p
}

const pool = await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, ids.length)) }, async () =>
        preparePage(await s.newPage()),
    ),
)

let next = 0
let done = 0
const t0 = Date.now()
/** Navigations a tab handles before it is replaced.
 *
 *  A single page driven through hundreds of story loads accumulates renderer memory until Chrome
 *  stops answering CDP at all — a full sweep died with `CDP timeout after 90000ms: Runtime.evaluate`.
 *  Recycling costs one target creation per 40 stories and keeps each renderer's lifetime short. */
const RECYCLE_EVERY = Number(arg('recycle', '40'))
const worker = async (initial: (typeof pool)[number]) => {
    let p = initial
    let handled = 0
    for (;;) {
        const i = next++
        if (i >= ids.length) return
        const id = ids[i]!
        if (handled >= RECYCLE_EVERY) {
            try { p = await preparePage(await s.newPage()) ; handled = 0 } catch { /* keep the old page */ }
        }
        handled++
        try {
            await p('Page.navigate', { url: `${BASE}/iframe.html?id=${id}&viewMode=story` })
            // Wait for the story to actually paint rather than sleeping a fixed amount. A story that
            // never paints still exits this loop and is reported as blank — it must never be silently
            // treated as "checked and clean".
            const deadline = Date.now() + READY_TIMEOUT
            for (;;) {
                const q: any = await p('Runtime.evaluate', {
                    expression: `(()=>{
  const SB=['storybook-root','storybook-docs','storybook-highlights-root'];
  const isChrome=el=>el.tagName==='SCRIPT'||el.tagName==='STYLE'||(el.id&&SB.indexOf(el.id)>=0)||/\\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\\b/.test(el.getAttribute('class')||'');
  const r=document.querySelector('#storybook-root'); if(!r) return 0;
  let n=r.querySelectorAll('*').length;
  for(const el of Array.prototype.slice.call(document.body.children)) if(el!==r&&!isChrome(el)) n+=el.querySelectorAll('*').length;
  return n})()`,
                    returnByValue: true,
                })
                if (!q.exceptionDetails && q.result.value > 0) break
                if (Date.now() > deadline) break
                await sleep(250)
            }
            await sleep(QUIET_AFTER_FIRST_PAINT)
            const r: any = await p('Runtime.evaluate', { expression: CHECKS, returnByValue: true })
            if (!r.exceptionDetails) {
                const v = JSON.parse(r.result.value)
                // A story that rendered nothing is REPORTED, never silently passed — the failure mode
                // that let mid-mount captures become blessed baselines in cssBaseline.ts.
                if (v.fatal || !v.count) blank.push(id)
                else for (const f of v.findings) findings.push({ ...f, story: id })
            }
        } catch (e) {
            // One story's failure must not abandon the other N-1 in flight.
            blank.push(`${id} (probe failed: ${String(e).slice(0, 60)})`)
        }
        done++
        const rate = (Date.now() - t0) / done
        const left = Math.round((rate * (ids.length - done)) / 1000)
        process.stderr.write(`\r[${done}/${ids.length}] ~${left}s left  ${id.slice(0, 44).padEnd(46)}`)
    }
}
await Promise.all(pool.map(worker))
process.stderr.write('\n')

/** A story that came back blank under N-way concurrency is usually just SLOW, not broken: 61 stories
 *  reported blank in a 6-worker sweep and `app-blockeditor--default` was among them, while the
 *  verified snapshot baseline records 307 elements for it. Contention delays the mount past the ready
 *  deadline. So every blank is re-checked ALONE with a longer deadline, and only what is still blank
 *  is reported — the same isolate-and-retry the snapshot gate uses to separate real drift from
 *  contention. */
if (blank.length) {
    process.stderr.write(`re-checking ${blank.length} blank story(s) serially…\n`)
    const suspects = blank.splice(0, blank.length)
    const solo = pool[0]!
    for (const id of suspects) {
        if (id.includes('probe failed')) { blank.push(id); continue }
        try {
        await solo('Page.navigate', { url: `${BASE}/iframe.html?id=${id}&viewMode=story` })
        const deadline = Date.now() + READY_TIMEOUT * 2
        let painted = false
        for (;;) {
            const q: any = await solo('Runtime.evaluate', {
                expression: `(()=>{
  const SB=['storybook-root','storybook-docs','storybook-highlights-root'];
  const isChrome=el=>el.tagName==='SCRIPT'||el.tagName==='STYLE'||(el.id&&SB.indexOf(el.id)>=0)||/\\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\\b/.test(el.getAttribute('class')||'');
  const r=document.querySelector('#storybook-root'); if(!r) return 0;
  let n=r.querySelectorAll('*').length;
  for(const el of Array.prototype.slice.call(document.body.children)) if(el!==r&&!isChrome(el)) n+=el.querySelectorAll('*').length;
  return n})()`,
                returnByValue: true,
            })
            if (!q.exceptionDetails && q.result.value > 0) { painted = true; break }
            if (Date.now() > deadline) break
            await sleep(250)
        }
        if (!painted) { blank.push(id); continue }
        await sleep(QUIET_AFTER_FIRST_PAINT)
        const r: any = await solo('Runtime.evaluate', { expression: CHECKS, returnByValue: true })
        if (r.exceptionDetails) { blank.push(id); continue }
        const v = JSON.parse(r.result.value)
        if (v.fatal || !v.count) blank.push(id)
        else for (const f of v.findings) findings.push({ ...f, story: id })
        } catch (e) {
            // Never lose the whole sweep here: every parallel result is already in hand by this point.
            blank.push(`${id} (retry failed: ${String(e).slice(0, 60)})`)
        }
    }
}
s.close()

if (has('json')) {
    console.log(JSON.stringify({ findings, blank }, null, 1))
} else {
    const byRule = new Map<string, Finding[]>()
    for (const f of findings) {
        if (!byRule.has(f.rule)) byRule.set(f.rule, [])
        byRule.get(f.rule)!.push(f)
    }
    for (const [rule, fs] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${rule} — ${fs.length}`)
        const seen = new Set<string>()
        for (const f of fs) {
            const k = `${f.story} ${f.path} ${f.detail}`
            if (seen.has(k)) continue
            seen.add(k)
            if (seen.size <= 12) console.log(`  ${f.story}  ${f.path}  ${f.detail}`)
        }
        if (fs.length > 12) console.log(`  … and ${fs.length - seen.size} more`)
    }
    if (blank.length) console.log(`\nRENDERED NOTHING — ${blank.length}\n  ${blank.join('\n  ')}`)
    console.log(`\n${findings.length} finding(s) across ${ids.length} stories`)
}
process.exit(findings.length || blank.length ? 1 : 0)
