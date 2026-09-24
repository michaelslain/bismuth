// #followup-1: parseFrontmatter used to return every value as the raw, trimmed line text — a
// value written quoted (by a display name that needed escaping) came back WITH its quote
// characters still attached, e.g. `"Answer Emails!"` rather than `Answer Emails!`. These tests
// pin the unquoting half (parseFrontmatter) and the quoting half (frontmatterValue) that a
// daemon-side writer uses to put a value back safely.
import { test, expect } from 'bun:test'
import { parseFrontmatter, frontmatterValue } from '../src/lib/frontmatter.ts'

test('parseFrontmatter unquotes a double-quoted value', () => {
    const { frontmatter } = parseFrontmatter(
        '---\nname: "hello world"\n---\n\nbody\n',
    )
    expect(frontmatter.name).toBe('hello world')
})

test('parseFrontmatter unquotes a single-quoted value, collapsing `\'\'` to a literal `\'`', () => {
    const { frontmatter } = parseFrontmatter(
        "---\nname: 'don''t stop'\n---\n\nbody\n",
    )
    expect(frontmatter.name).toBe("don't stop")
})

test('a bare (unquoted) value is returned unchanged', () => {
    const { frontmatter } = parseFrontmatter('---\nname: hello\n---\n\nbody\n')
    expect(frontmatter.name).toBe('hello')
})

test('a JSON array value (starts with `[`) is left exactly as written, never mistaken for a quoted string', () => {
    const { frontmatter } = parseFrontmatter(
        '---\nargs: ["x"]\n---\n\nbody\n',
    )
    expect(frontmatter.args).toBe('["x"]')
})

test('a value that only OPENS with a quote (no matching close) is left as-is, not stripped', () => {
    const { frontmatter } = parseFrontmatter('---\nname: "unterminated\n---\n\nbody\n')
    expect(frontmatter.name).toBe('"unterminated')
})

test('frontmatterValue + parseFrontmatter round-trips a name containing `:`, `#`, and `"`', () => {
    const original = 'foo: bar # baz "quoted"'
    const written = frontmatterValue(original)
    const { frontmatter } = parseFrontmatter(`---\nname: ${written}\n---\n\nbody\n`)
    expect(frontmatter.name).toBe(original)
})

test('frontmatterValue leaves a safe plain value bare', () => {
    expect(frontmatterValue('Answer Emails!')).toBe('Answer Emails!')
    expect(frontmatterValue('dream')).toBe('dream')
})

test('frontmatterValue quotes a value containing a colon', () => {
    expect(frontmatterValue('Ops: Nightly')).toBe('"Ops: Nightly"')
})

test('frontmatterValue quotes a value containing a hash', () => {
    expect(frontmatterValue('urgent #1')).toBe('"urgent #1"')
})

test('frontmatterValue quotes a value with an unsafe leading character', () => {
    for (const bad of ['"quoted', "'quoted", '[bracket', '{brace', '&anchor', '*alias', '!tag', '|literal', '>folded', '%directive', '@reserved', '`tick']) {
        expect(frontmatterValue(bad)).toBe(JSON.stringify(bad))
    }
})

test('frontmatterValue quotes a value with leading or trailing whitespace', () => {
    expect(frontmatterValue(' padded')).toBe(JSON.stringify(' padded'))
    expect(frontmatterValue('padded ')).toBe(JSON.stringify('padded '))
})

test('frontmatterValue quotes the empty string', () => {
    expect(frontmatterValue('')).toBe('""')
})
