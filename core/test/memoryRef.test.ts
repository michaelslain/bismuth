import { describe, expect, test } from 'bun:test'
import {
    MEMORY_DIR,
    MEMORY_REF_RE,
    matchMemoryRefPrefix,
    memorySlugFromNodeId,
    memoryRefPath,
    resolveMemorySlug,
    buildMemoryRefInsert,
    type MemoryCandidate,
} from '../src/memoryRef'

// Scan helper: every `~slug` in a source string (the shape a renderer consumes).
const scan = (src: string) => [...src.matchAll(MEMORY_REF_RE)].map(m => m[2])

describe('matchMemoryRefPrefix (the `~` autocomplete trigger)', () => {
    test('opens once `~` is followed by a letter, reporting where the slug starts', () => {
        expect(matchMemoryRefPrefix('~c')).toEqual({ from: 1, query: 'c' })
        // "see ~cron" — the `~` sits at 4, so the slug starts at 5.
        expect(matchMemoryRefPrefix('see ~cron')).toEqual({
            from: 5,
            query: 'cron',
        })
        expect(matchMemoryRefPrefix('(~cron')).toEqual({ from: 2, query: 'cron' })
    })

    test('a bare `~` does not open the picker — it is common punctuation', () => {
        expect(matchMemoryRefPrefix('~')).toBeNull()
        expect(matchMemoryRefPrefix('about ~')).toBeNull()
    })

    test('captures the partial slug typed so far, including `-` and `/`', () => {
        expect(matchMemoryRefPrefix('~cron-run')).toEqual({
            from: 1,
            query: 'cron-run',
        })
        expect(matchMemoryRefPrefix('~sub/dir')).toEqual({
            from: 1,
            query: 'sub/dir',
        })
    })

    test('stays shut for the everyday uses of `~`', () => {
        expect(matchMemoryRefPrefix('~5')).toBeNull() // approximate
        expect(matchMemoryRefPrefix('cd ~/Doc')).toBeNull() // home path
        expect(matchMemoryRefPrefix('~~str')).toBeNull() // strikethrough
        expect(matchMemoryRefPrefix('a~b')).toBeNull() // glued to a word
    })

    test('does not fire once the caret has left the slug', () => {
        expect(matchMemoryRefPrefix('~cron ')).toBeNull()
    })

    test('picks the RIGHTMOST `~` on the line', () => {
        expect(matchMemoryRefPrefix('~one and ~tw')).toEqual({
            from: 10,
            query: 'tw',
        })
    })
})

describe('MEMORY_REF_RE (the persisted `~slug` syntax)', () => {
    test('finds refs at start of line and after whitespace/`(`', () => {
        expect(scan('~alpha')).toEqual(['alpha'])
        expect(scan('see ~alpha for context')).toEqual(['alpha'])
        expect(scan('(~alpha)')).toEqual(['alpha'])
    })

    test('finds several refs in one string', () => {
        expect(scan('~alpha and ~beta-two')).toEqual(['alpha', 'beta-two'])
    })

    test('a slug may contain `-`, `/` and digits but must START with a letter', () => {
        expect(scan('~cron-run-preference')).toEqual(['cron-run-preference'])
        expect(scan('~sub/dir/note')).toEqual(['sub/dir/note'])
        expect(scan('~v2-notes')).toEqual(['v2-notes'])
        expect(scan('~-leading-dash')).toEqual([])
        expect(scan('~/slash')).toEqual([])
        expect(scan('~5 minutes')).toEqual([])
    })

    test('leaves strikethrough, home paths and glued tildes alone', () => {
        expect(scan('~~struck~~')).toEqual([])
        expect(scan('open ~/Documents')).toEqual([])
        expect(scan('a~b')).toEqual([])
        expect(scan('~')).toEqual([])
    })

    test('the old `??slug` spelling is plain text', () => {
        expect(scan('see ??alpha')).toEqual([])
    })

    test('the ref stops at the first non-slug char, so trailing punctuation stays prose', () => {
        expect(scan('see ~alpha.')).toEqual(['alpha'])
        expect(scan('see ~alpha, and more')).toEqual(['alpha'])
    })
})

describe('slug <-> path <-> node id', () => {
    test("memorySlugFromNodeId strips the graph's `mem:` namespace", () => {
        expect(memorySlugFromNodeId('mem:cron-run-preference')).toBe(
            'cron-run-preference',
        )
        expect(memorySlugFromNodeId('mem:sub/dir/note')).toBe('sub/dir/note')
        // Already-bare ids pass through untouched.
        expect(memorySlugFromNodeId('cron-run-preference')).toBe(
            'cron-run-preference',
        )
    })

    test('memoryRefPath maps a slug to its real vault-relative file', () => {
        expect(memoryRefPath('cron-run-preference')).toBe(
            `${MEMORY_DIR}/cron-run-preference.md`,
        )
        expect(memoryRefPath('sub/dir/note')).toBe(
            '.daemon/memory/sub/dir/note.md',
        )
    })
})

describe('resolveMemorySlug', () => {
    const candidates: MemoryCandidate[] = [
        { label: 'note', slug: 'sub/dir/note' },
        { label: 'cron-run-preference', slug: 'cron-run-preference' },
    ]

    test('resolves an exact slug (full relative id)', () => {
        expect(resolveMemorySlug('sub/dir/note', candidates)).toBe(
            'sub/dir/note',
        )
    })

    test('falls back to a basename match, like wikilink resolution', () => {
        expect(resolveMemorySlug('note', candidates)).toBe('sub/dir/note')
    })

    test('returns null for an unknown slug', () => {
        expect(resolveMemorySlug('nope', candidates)).toBeNull()
    })

    test('returns null against an EMPTY candidate list — the daemon-disabled case', () => {
        // Daemon off → no memory dir → no memory graph nodes → nothing resolves, no crash.
        expect(resolveMemorySlug('cron-run-preference', [])).toBeNull()
    })
})

describe('buildMemoryRefInsert', () => {
    test('inserts the bare slug (the `~` is already typed) with the caret just past it', () => {
        expect(buildMemoryRefInsert('cron-run')).toEqual({
            insert: 'cron-run',
            cursorOffset: 8,
        })
    })
})
