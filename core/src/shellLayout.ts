// core/src/shellLayout.ts
// Pure helpers for the `layout:` settings group (which side the sidebar and tab rail sit on, which
// sidebar sections show and in what order). No imports — the schema, the app shell and the palette
// commands all read it. Not core/src/layout.ts, which is the GRAPH layout engine.
export type Side = 'left' | 'right'
export type SidebarSection = 'toolbar' | 'files' | 'graph'

/** Every sidebar section, top to bottom — also the default order. */
export const SIDEBAR_SECTIONS: readonly SidebarSection[] = [
    'toolbar',
    'files',
    'graph',
]

export function otherSide(side: Side): Side {
    return side === 'left' ? 'right' : 'left'
}

/** Known ids only, first occurrence wins, order kept. Non-array → SIDEBAR_SECTIONS copy. */
export function normalizeSidebarSections(list: unknown): SidebarSection[] {
    if (!Array.isArray(list)) return [...SIDEBAR_SECTIONS]
    const out: SidebarSection[] = []
    for (const id of list) {
        if (
            (SIDEBAR_SECTIONS as readonly unknown[]).includes(id) &&
            !out.includes(id as SidebarSection)
        )
            out.push(id as SidebarSection)
    }
    return out
}
