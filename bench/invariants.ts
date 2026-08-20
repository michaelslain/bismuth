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
const SETTLE = Number(arg('settle', '1500'))
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
])

const CHECKS = `(() => {
    const root = document.querySelector('#storybook-root')
    if (!root) return JSON.stringify({ fatal: 'no #storybook-root' })
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
    const hasText = el => {
        for (const n of el.childNodes)
            if (n.nodeType === 3 && n.textContent.trim()) return true
        return false
    }

    const all = Array.from(root.querySelectorAll('*'))
    const seenSize = new Set()
    for (const el of all) {
        if (!vis(el)) continue
        const cs = getComputedStyle(el)
        const box = el.getBoundingClientRect()

        // 1. TEXT TOO SMALL TO READ. Under any design, body text below the smallest scale step is a
        //    mistake. Uses the scale's own floor rather than an invented number.
        if (hasText(el)) {
            const fs = parseFloat(cs.fontSize)
            if (fs && fs < 10.5) add('text-too-small', cs.fontSize, el)
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

    // 6. CONTENT ESCAPING THE VIEWPORT HORIZONTALLY. Layout breakage that no palette change causes.
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
        out.push({
            rule: 'page-overflows-x',
            detail: document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth,
            path: 'html',
        })

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

/** Every page needs the SAME viewport and timezone. Applying them per page rather than once is not
 *  redundant: each tab is an independent target and inherits none of the first one's overrides, so a
 *  forgotten call here would silently check some stories at Chrome's default metrics. */
const preparePage = async (p: Awaited<ReturnType<typeof s.newPage>>) => {
    await p('Emulation.setDeviceMetricsOverride', {
        width: W, height: H, deviceScaleFactor: 1, mobile: false,
    })
    await p('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
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
const worker = async (p: (typeof pool)[number]) => {
    for (;;) {
        const i = next++
        if (i >= ids.length) return
        const id = ids[i]!
        try {
            await p('Page.navigate', { url: `${BASE}/iframe.html?id=${id}&viewMode=story` })
            await sleep(SETTLE)
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
