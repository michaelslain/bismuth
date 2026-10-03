// Pure timing for the intro copy's type-in (IntroCopy.tsx drives it from a rAF loop). No framework
// imports, so it is unit-testable.
//
// Keystrokes are irregular the way a person's are: every character gets its own delay, a little
// faster or slower than the average, a longer beat after a space and after punctuation, and now and
// then a hesitation. The jitter comes from a hash of the character's index, never Math.random, so a
// given text always types with the same rhythm (and a test can pin it).
import { cellHash } from '../ui/ascii/glyphScene'

/** Headline: one character every 28ms on average. */
export const TITLE_MS_PER_CHAR = 28
/** The body never takes longer than this to type, however long it is. */
export const BODY_MAX_MS = 1200
/** The beat between the headline's last character and the body's first. */
export const TITLE_TO_BODY_MS = 180

const BODY_MS_PER_CHAR = 14
/** A character's delay is the average times a factor in [JITTER_MIN, JITTER_MIN + JITTER_SPAN). */
const JITTER_MIN = 0.35
const JITTER_SPAN = 1.3
const SPACE_BEAT = 1.6
const PUNCT_BEAT = 4
const HESITATE_CHANCE = 0.06
const HESITATE_BEAT = 5

const PUNCT = new Set(['.', ',', ';', ':', '?', '!', '—', '-'])

/** Cumulative ms (from the text's first keystroke) at which each character has appeared:
 *  `at[i]` is when character i shows. Irregular per character, deterministic per `seed`. */
export function keystrokeTimes(
    text: string,
    msPerChar: number,
    seed: number,
): number[] {
    const at: number[] = []
    let t = 0
    for (let i = 0; i < text.length; i++) {
        let delay =
            msPerChar * (JITTER_MIN + JITTER_SPAN * cellHash(i, 0, seed))
        const prev = text[i - 1]
        if (prev === ' ') delay += msPerChar * SPACE_BEAT
        else if (prev !== undefined && PUNCT.has(prev))
            delay += msPerChar * PUNCT_BEAT
        if (cellHash(i, 1, seed) < HESITATE_CHANCE)
            delay += msPerChar * HESITATE_BEAT
        t += delay
        at.push(t)
    }
    return at
}

export type TypingPlan = {
    /** When each headline character appears (ms from mount). */
    title: number[]
    /** When each body character appears (ms from mount). */
    body: number[]
    /** When both texts are whole. */
    duration: number
}

/** The whole type-in: the headline at its own pace, a beat, then the body — scaled down to fit
 *  BODY_MAX_MS when a long body would otherwise drag. */
export function typingPlan(title: string, body: string): TypingPlan {
    const titleAt = keystrokeTimes(title, TITLE_MS_PER_CHAR, 11)
    const titleEnd = titleAt.length ? titleAt[titleAt.length - 1] : 0
    const raw = keystrokeTimes(body, BODY_MS_PER_CHAR, 23)
    const rawEnd = raw.length ? raw[raw.length - 1] : 0
    const scale = rawEnd > BODY_MAX_MS ? BODY_MAX_MS / rawEnd : 1
    const bodyStart = titleEnd + (body.length ? TITLE_TO_BODY_MS : 0)
    const bodyAt = raw.map(t => bodyStart + t * scale)
    const duration = bodyAt.length ? bodyAt[bodyAt.length - 1] : titleEnd
    return { title: titleAt, body: bodyAt, duration }
}

/** How many of `at`'s characters have appeared by `elapsed` (binary search; `at` is ascending). */
function shown(at: number[], elapsed: number): number {
    let lo = 0
    let hi = at.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (at[mid] <= elapsed) lo = mid + 1
        else hi = mid
    }
    return lo
}

/** How many chars of title and body are typed at elapsed ms. */
export function typedCounts(
    elapsed: number,
    plan: TypingPlan,
): { title: number; body: number } {
    return {
        title: shown(plan.title, elapsed),
        body: shown(plan.body, elapsed),
    }
}
