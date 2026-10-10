/** Mirrors composeBrain in core/src/brain.ts (the daemon only uses the daemon channel). */
export function composeBrain(opts: {
    vaultDir: string
    memoryDir: string | null
    channel: 'chat' | 'daemon'
    budgetChars?: number
    waitMs?: number
}): Promise<string | null>

/** Drop the cached map for a vault (core/src/brain.ts). */
export function invalidateBrain(vaultDir: string): void
