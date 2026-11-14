// The task status option set and its filtering: pure data, no framework imports, so a test can
// import it (Bun cannot compile Solid JSX; the menu's rows live in taskStatusMenu.tsx).
export interface TaskStatusOption {
    char: string
    label: string
}

export const TASK_STATUS_OPTIONS: TaskStatusOption[] = [
    { char: ' ', label: 'to do' },
    { char: '/', label: 'in progress' },
    { char: 'x', label: 'done' },
    { char: '-', label: 'cancelled' },
]

/** True if option `optChar` is the task's current status (so it should be hidden from the menu).
 *  Folds the case/alias variants: `x`/`X` (done), `/`/`\` (in progress). */
export function isCurrentStatus(optChar: string, cur: string): boolean {
    if (optChar === 'x') return cur === 'x' || cur === 'X'
    if (optChar === '/') return cur === '/' || cur === '\\'
    return optChar === cur
}

/** The options a task whose current box char is `cur` is offered: every status but its own. */
export function otherStatuses(cur: string): TaskStatusOption[] {
    return TASK_STATUS_OPTIONS.filter(o => !isCurrentStatus(o.char, cur))
}
