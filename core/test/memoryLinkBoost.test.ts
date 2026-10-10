import { test, expect } from 'bun:test'
import type { MemoryNote } from '@bismuth/memory'
import { neighbourNames, notesAbout } from '../src/memoryLinkBoost'

const note = (name: string, backlinks: string[] = []): MemoryNote =>
    ({ name, content: '', backlinks, frontmatter: { type: 'fact', tags: [] } }) as unknown as MemoryNote

const names = (ns: MemoryNote[]) => ns.map(n => n.name)

test('notesAbout matches a link by basename or by full vault path', () => {
    const notes = [
        note('by-base', ['plan']),
        note('by-path', ['projects/plan']),
        note('by-ext', ['Projects/Plan.md|the plan']),
        note('other-folder', ['archive/plan']),
        note('unrelated', ['elsewhere']),
    ]
    expect(names(notesAbout(notes, ['projects/plan.md']))).toEqual(['by-base', 'by-path', 'by-ext'])
})

test('notesAbout ranks notes linking more of the paths first, then keeps input order', () => {
    const notes = [note('one', ['a']), note('two', ['a', 'b']), note('none', ['z']), note('also-one', ['b'])]
    expect(names(notesAbout(notes, ['a.md', 'b.md']))).toEqual(['two', 'one', 'also-one'])
})

test('notesAbout with no paths or no links is empty', () => {
    expect(notesAbout([note('x', ['a'])], [])).toEqual([])
    expect(notesAbout([note('x')], ['a.md'])).toEqual([])
})

test('neighbourNames follows links in both directions, excludes injected, strongest first', () => {
    const notes = [
        note('seed', ['out-one', 'both']),
        note('seed-two', ['both']),
        note('out-one'),
        note('both'),
        note('links-in', ['seed']),
        note('far', ['out-one']),
    ]
    expect(neighbourNames(notes, ['seed', 'seed-two'])).toEqual(['both', 'links-in', 'out-one'])
    expect(neighbourNames(notes, [])).toEqual([])
    expect(neighbourNames(notes, ['seed', 'both'])).not.toContain('seed')
})
