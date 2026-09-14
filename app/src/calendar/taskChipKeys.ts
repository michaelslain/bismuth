// Pure: which task-chip action a keydown means. No framework imports, so the mapping is unit-tested
// headlessly and TaskChip.tsx only wires the result.
import type { Row } from '../../../core/src/bases/types'

export type ChipKeyInput = {
    key: string
    altKey: boolean
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
}

export type ChipKeyAction =
    | { kind: 'open' }
    | { kind: 'toggle' }
    | { kind: 'menu' }
    | { kind: 'reschedule'; days: number }

const ALT_ARROWS: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
}

/** Ctrl/Meta combos always return null so browser and app shortcuts pass through untouched. */
export function chipKeyAction(e: ChipKeyInput): ChipKeyAction | null {
    if (e.ctrlKey || e.metaKey) return null
    if (e.altKey) {
        if (e.shiftKey) return null
        const days = ALT_ARROWS[e.key]
        return days === undefined ? null : { kind: 'reschedule', days }
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) return { kind: 'menu' }
    if (e.shiftKey) return null
    if (e.key === 'Enter') return { kind: 'open' }
    if (e.key === ' ') return { kind: 'toggle' }
    return null
}

/** A task's identity across re-renders: the markdown line it lives on. */
export function taskKey(row: Row): string {
    return `${row.file.path}:${String(row.note.line)}`
}
