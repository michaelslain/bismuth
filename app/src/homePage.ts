import { GRAPH_TAB } from './tabIds'

/** The content a new / first / replacement home tab opens: the configured note path, or the graph. */
export function homeContent(homePage: string | undefined): string {
    const p = (homePage ?? '').trim()
    return p === '' ? GRAPH_TAB : p
}

/** The content a seeded home tab should be retargeted to once real settings hydrate, or undefined to leave it. */
export function retargetSeed(
    content: string,
    seedContent: string,
    want: string,
): string | undefined {
    return content === seedContent && want !== seedContent ? want : undefined
}
