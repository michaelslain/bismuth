/** Run one scheduler tick; a throw is logged and swallowed so the next tick still runs. */
export async function safeTick(
    name: string,
    fn: () => Promise<void>,
): Promise<void> {
    try {
        await fn()
    } catch (err) {
        console.error(`[${name}] tick failed: ${err}`)
    }
}
