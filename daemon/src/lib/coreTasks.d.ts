/** Structural mirror of core's DenyEntry (core/src/visibility.ts). */
export interface CoreDenyEntry {
    rel: string
    abs: string
    aliases?: string[]
    kind?: 'chat'
}

/** Mirrors dueTasks in core/src/dueTasks.ts: open tasks due before `before`, earliest first. */
export function dueTasks(
    vault: string,
    opts: { before: string; deny: CoreDenyEntry[] },
): Promise<{ text: string; due: string; path: string }[]>

/** Mirrors isDeniedPath in core/src/visibility.ts. */
export function isDeniedPath(entries: CoreDenyEntry[], candidate: string): boolean
