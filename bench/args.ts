/**
 * bench/args.ts — the one argv reader and story-index loader every bench tool shares.
 *
 * `arg` refuses a value that starts with `--`, so `--story --json` reads as a missing value rather
 * than swallowing the next flag.
 */
export const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
        ? process.argv[i + 1]!
        : d
}
export const has = (n: string) => process.argv.includes(`--${n}`)

/** Every value of a repeatable flag, each also split on commas: `--story a --story b,c` -> a b c. */
export const argAll = (n: string): string[] => {
    const out: string[] = []
    process.argv.forEach((a, i) => {
        const v = process.argv[i + 1]
        if (a === `--${n}` && v && !v.startsWith('--')) out.push(...v.split(','))
    })
    return out.map(s => s.trim()).filter(Boolean)
}

export const BASE = arg('base', 'http://localhost:6006')

/** A story filter: empty matches everything; otherwise an exact id or a prefix of any listed value. */
export const storyMatcher = (only: string | string[] = '') => {
    const list = (Array.isArray(only) ? only : [only]).filter(Boolean)
    return (id: string) => !list.length || list.some(o => id === o || id.startsWith(o))
}

/** The Storybook index's STORY entries (never docs), filtered by `only`, sorted by id. */
export const loadStoryIndex = async (base: string, only: string | string[] = '') => {
    const index = await (await fetch(`${base}/index.json`)).json()
    const match = storyMatcher(only)
    return (Object.values(index.entries as Record<string, any>) as any[])
        .filter(e => e.type === 'story' && match(e.id))
        .sort((a, b) => a.id.localeCompare(b.id))
}
