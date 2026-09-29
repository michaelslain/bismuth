// Pure column bookkeeping behind FlashcardsView's grading/reset and EditCardsModal's reset — one
// definition of "which columns does this direction schedule" and "which columns does a reset
// strip", instead of the two hand-copies the view and the modal each carried. No framework
// imports, so it is unit-testable headlessly (flashcardsActions.test.ts).
import { backField, type CardDir } from './flashcardsQueue'

export type ScheduleColumns = { due: string; ease: string; interval: string }

/** Which scheduling columns a direction advances: forward uses the base triple, reverse uses the
 *  `*Back` companions so each direction is scheduled independently. */
export function scheduleColumns(
    dir: CardDir,
    base: ScheduleColumns,
): ScheduleColumns {
    if (dir === 'fwd') return { ...base }
    return {
        due: backField(base.due),
        ease: backField(base.ease),
        interval: backField(base.interval),
    }
}

/** Every column a "reset progress" strips — the forward triple, plus its `*Back` companions on a
 *  bidirectional deck. */
export function resetKeys(
    base: ScheduleColumns,
    bidirectional: boolean,
): string[] {
    const fwd = [base.due, base.ease, base.interval]
    return bidirectional ? [...fwd, ...fwd.map(backField)] : fwd
}

/** A copy of `note` without the named columns; front/back and every other field survive. */
export function stripSchedule(
    note: Record<string, unknown>,
    keys: string[],
): Record<string, unknown> {
    const next = { ...note }
    for (const k of keys) delete next[k]
    return next
}

/** The side being asked. For a reverse card the back column is the prompt. */
export function promptColumn(dir: CardDir, front: string, back: string): string {
    return dir === 'fwd' ? front : back
}

/** The side revealed. For a reverse card the front column is the answer. */
export function answerColumn(dir: CardDir, front: string, back: string): string {
    return dir === 'fwd' ? back : front
}
