// app/src/math.ts
//
// Shared pure numeric helpers. No framework imports.

/** `v` limited to `[lo, hi]`. Same evaluation order as the hand-written `Math.max(lo, Math.min(hi, v))`:
 *  when `lo > hi` the result is `lo`, and a NaN `v` stays NaN. */
export function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
}

/** `v` limited to `[0, 1]`. */
export function clamp01(v: number): number {
    return clamp(v, 0, 1)
}
