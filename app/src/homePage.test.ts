import { expect, test } from 'bun:test'
import { homeContent, retargetSeed } from './homePage'
import { GRAPH_TAB } from './tabIds'

test('empty, blank and undefined fall back to the graph', () => {
    expect(homeContent('')).toBe(GRAPH_TAB)
    expect(homeContent('  ')).toBe(GRAPH_TAB)
    expect(homeContent(undefined)).toBe(GRAPH_TAB)
})

test('a path is returned trimmed', () => {
    expect(homeContent('Home.md')).toBe('Home.md')
    expect(homeContent('  Home.md ')).toBe('Home.md')
})

test('retargetSeed only moves a tab still exactly as seeded', () => {
    expect(retargetSeed(GRAPH_TAB, GRAPH_TAB, 'Home.md')).toBe('Home.md')
    expect(retargetSeed('Other.md', GRAPH_TAB, 'Home.md')).toBeUndefined()
    expect(retargetSeed(GRAPH_TAB, GRAPH_TAB, GRAPH_TAB)).toBeUndefined()
})
