// bench/poolSize.ts — how many concurrent Chrome targets a sweep should run.
//
// THE ONE PLACE THAT ANSWERS THIS. Three sweeps pool (invariants, playCheck, storyAudit) and each
// used to answer it separately: two hardcoded `6`, one not pooling at all. A constant is tuned for
// whichever machine the author had — it starves a 16-core box and thrashes a 4-core one — and the
// symptom of the first case is the one a human notices from outside: a long run at single-digit CPU.
// storyAudit measured 172 stories in 3m02s at 13% CPU before it pooled.
//
// TWO BUDGETS, SMALLER WINS.
//   CPU — one worker per core less one, so the pool does not fight the browser's own compositor.
//   MEM — a headless target costs roughly TAB_MB, and we spend at most half of what is currently
//         FREE (not total), so a sweep can never push the machine into swap. Swapping is slower than
//         staying serial, so the memory term is a floor on correctness, not just on politeness.
//
// WHY THE CEILING IS NOT JUST "ALL THE CORES". invariants.ts's original comment records a real
// failure this guards against, and it is worth preserving rather than rediscovering: a story starved
// of CPU mounts LATER, and a late mount is exactly the condition that produced mid-mount captures in
// the snapshot gate. So the pool stays modest by default even on a large machine. `--concurrency`
// overrides for anyone who wants to push it.
import { cpus, freemem } from 'node:os'

/** Rough resident cost of one headless Chrome target, in bytes. */
const TAB_BYTES = 120e6

/**
 * Concurrency for a browser-target pool, derived from this machine.
 *
 * @param max ceiling. Defaults to 8 — above that, targets contend on CDP round-trips and on the
 *            mid-mount hazard above more than the extra parallelism returns. storyAudit passes a
 *            higher ceiling because it navigates and screenshots rather than waiting on a play()
 *            function, so a late mount costs it a settle loop rather than a wrong capture.
 */
export function poolSize(max = 8): number {
    const cpuBudget = Math.max(2, cpus().length - 1)
    const memBudget = Math.max(2, Math.floor((freemem() * 0.5) / TAB_BYTES))
    return Math.max(2, Math.min(max, cpuBudget, memBudget))
}
