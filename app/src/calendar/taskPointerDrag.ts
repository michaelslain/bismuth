// Dragging a task chip to another day, on pointer events. HTML5 drag-and-drop never reaches the
// desktop app's WKWebView, so — like the kanban (bases/kanbanDrag.ts) and the page sorter
// (bases/BookPageEditor.tsx) — a press on a chip arms, a move past the threshold commits, a ghost
// follows the cursor, and the day under the cursor is resolved with elementFromPoint on the
// `data-task-drop` attribute every day cell carries. Releasing over a day dispatches
// TASK_DROP_EVENT on that cell; the cell (MonthCell, AllDayRow) hands it to its reschedule.
import { createSignal, onCleanup } from 'solid-js'
import type { TaskRowRef } from './taskDrag'
import { pastThreshold } from '../bases/pageSortDrag'
import { isDismissKey } from '../ui/widgetKeys'

/** The attribute naming a day cell's `YYYY-MM-DD`, which makes it a drop target. */
export const TASK_DROP_ATTR = 'data-task-drop'

/** Dispatched (not bubbling) on the day cell a dragged chip is released over. */
export const TASK_DROP_EVENT = 'bismuth-task-drop'

export type TaskDropDetail = { ref: TaskRowRef; date: string }

export type TaskDragGhost = { key: string; label: string; x: number; y: number }

const [overDate, setOverDate] = createSignal<string | null>(null)
const [ghost, setGhost] = createSignal<TaskDragGhost | null>(null)

/** The day the dragged chip is over (null when no drag, or off every day). */
export const taskDragOver = overDate

/** The live ghost: which chip (its task key) is dragged, its label, and the cursor. */
export const taskDragGhost = ghost

/** The day cell under a viewport point: the nearest `data-task-drop` ancestor. */
function dropCellAt(x: number, y: number): HTMLElement | null {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${TASK_DROP_ATTR}]`) ?? null
}

type Press = {
    id: number
    x: number
    y: number
    ref: TaskRowRef
    key: string
    label: string
    from: string | null
}

let press: Press | null = null

function onMove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return
    if (!ghost()) {
        if (!pastThreshold(e.clientX - press.x, e.clientY - press.y)) return
        document.documentElement.classList.add('task-dragging')
        window.getSelection()?.removeAllRanges()
    }
    e.preventDefault()
    setGhost({ key: press.key, label: press.label, x: e.clientX, y: e.clientY })
    setOverDate(dropCellAt(e.clientX, e.clientY)?.getAttribute(TASK_DROP_ATTR) ?? null)
}

// A released drag still produces a click on whatever sits under both ends (the day cell, which
// opens the composer); swallow that one click.
function swallowClick(): void {
    const eat = (e: MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
    }
    window.addEventListener('click', eat, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0)
}

function onUp(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return
    const p = press
    const dragged = ghost() !== null
    const cell = dragged ? dropCellAt(e.clientX, e.clientY) : null
    const date = cell?.getAttribute(TASK_DROP_ATTR)
    stop()
    if (!dragged) return
    swallowClick()
    if (!cell || !date || date === p.from) return
    cell.dispatchEvent(
        new CustomEvent<TaskDropDetail>(TASK_DROP_EVENT, { detail: { ref: p.ref, date } }),
    )
}

function onKey(e: KeyboardEvent): void {
    if (isDismissKey(e) && ghost()) stop()
}

function stop(): void {
    press = null
    setGhost(null)
    setOverDate(null)
    document.documentElement.classList.remove('task-dragging')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('keydown', onKey)
}

/** Arm a drag from a chip's pointerdown. A press on a control inside the chip (the `[ ]` mark, a
 *  link) is that control's; a secondary button never drags. */
export function startTaskDrag(e: PointerEvent, ref: TaskRowRef, key: string, label: string): void {
    if (e.button !== 0) return
    if ((e.target as Element).closest('a, button, input, textarea, [role="checkbox"]')) return
    stop()
    const fromCell = (e.currentTarget as Element).closest(`[${TASK_DROP_ATTR}]`)
    press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        ref,
        key,
        label,
        from: fromCell?.getAttribute(TASK_DROP_ATTR) ?? null,
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('keydown', onKey)
}

/** Make `el` receive drops: `handler` runs with the dragged row and the cell's date. Call from a
 *  ref; the listener goes with the owning component. */
export function onTaskDrop(el: HTMLElement, handler: (ref: TaskRowRef, date: string) => void): void {
    const listen = (e: Event) => {
        const d = (e as CustomEvent<TaskDropDetail>).detail
        handler(d.ref, d.date)
    }
    el.addEventListener(TASK_DROP_EVENT, listen)
    onCleanup(() => el.removeEventListener(TASK_DROP_EVENT, listen))
}
