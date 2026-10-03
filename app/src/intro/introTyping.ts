// Pure timing for the intro copy's type-in (IntroCopy.tsx drives it from a rAF loop). No framework
// imports, so it is unit-testable.

/** Headline speed: one character every 28ms. */
export const TITLE_MS_PER_CHAR = 28
/** The body never takes longer than this to type, however long it is. */
export const BODY_MAX_MS = 900

const BODY_MAX_MS_PER_CHAR = 14

function bodyMsPerChar(bodyLen: number): number {
    return bodyLen > 0
        ? Math.min(BODY_MAX_MS_PER_CHAR, BODY_MAX_MS / bodyLen)
        : BODY_MAX_MS_PER_CHAR
}

/** How many chars of title and body are typed at elapsed ms: title first, then body.
 *  Body speed = min(14, BODY_MAX_MS / body.length) ms per char. */
export function typedCounts(
    elapsed: number,
    titleLen: number,
    bodyLen: number,
): { title: number; body: number } {
    const title = Math.min(
        titleLen,
        Math.max(0, Math.floor(elapsed / TITLE_MS_PER_CHAR)),
    )
    const bodyElapsed = elapsed - TITLE_MS_PER_CHAR * titleLen
    const body = Math.min(
        bodyLen,
        Math.max(0, Math.floor(bodyElapsed / bodyMsPerChar(bodyLen))),
    )
    return { title, body }
}

/** Total ms until both texts are whole. */
export function typingDuration(titleLen: number, bodyLen: number): number {
    return TITLE_MS_PER_CHAR * titleLen + bodyMsPerChar(bodyLen) * bodyLen
}
