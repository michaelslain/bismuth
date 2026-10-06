// Pure column order for the app frame's grid — no framework imports. The frame places three cells
// (sidebar, tab rail, main) in one row; which side each outer cell sits on is a setting.
export type ShellCell = 'sidebar' | 'rail' | 'main'

/** Left → right. Same side: sidebar outermost, the rail between it and main. */
export function shellColumns(
    sidebarSide: 'left' | 'right',
    tabRailSide: 'left' | 'right',
): ShellCell[] {
    if (sidebarSide === tabRailSide) {
        return sidebarSide === 'left'
            ? ['sidebar', 'rail', 'main']
            : ['main', 'rail', 'sidebar']
    }
    return sidebarSide === 'left'
        ? ['sidebar', 'main', 'rail']
        : ['rail', 'main', 'sidebar']
}

const TRACK: Record<ShellCell, string> = {
    sidebar: 'var(--sidebar-w)',
    rail: 'var(--rail-w)',
    main: '1fr',
}

/** e.g. 'var(--sidebar-w) 1fr var(--rail-w)' for the default. */
export function gridTemplateColumns(cells: ShellCell[]): string {
    return cells.map(c => TRACK[c]).join(' ')
}

/** e.g. '"sidebar main rail"'. */
export function gridTemplateAreas(cells: ShellCell[]): string {
    return `"${cells.join(' ')}"`
}
