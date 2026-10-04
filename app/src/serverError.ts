/** The human message inside an api.ts error. `api.ts` throws `new Error(await r.text())`, so a
 *  route's `{"error": "…"}` body arrives as the message verbatim; this unwraps it. Non-JSON
 *  messages and non-Error values pass through as String(). */
export function serverErrorText(e: unknown): string {
    const message = e instanceof Error ? e.message : String(e)
    try {
        const body = JSON.parse(message)
        if (body && typeof body.error === 'string') return body.error
    } catch {}
    return message
}
