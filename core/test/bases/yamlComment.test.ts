import { test, expect } from 'bun:test'
import { findCommentTruncations } from '../../src/bases/yamlComment'

test('a hashtag preceded by a space truncates a plain scalar', () => {
    const found = findCommentTruncations('filters: tags.contains(" #book")\n')
    expect(found).toEqual([
        {
            key: 'filters',
            line: 1,
            kept: 'tags.contains("',
            dropped: '#book")',
        },
    ])
})

test('a hashtag with no space before it is NOT a comment', () => {
    expect(findCommentTruncations('filters: tags.contains("#book")\n')).toEqual(
        [],
    )
})

test('a single-quoted scalar is not truncated', () => {
    expect(
        findCommentTruncations(`filters: 'tags.contains(" #book")'\n`),
    ).toEqual([])
})

test('a double-quoted scalar is not truncated', () => {
    expect(
        findCommentTruncations('filters: "tags.contains(\\" #book\\")"\n'),
    ).toEqual([])
})

test('a whole-line comment is not a truncation', () => {
    expect(findCommentTruncations('# just a comment\nfilters: done\n')).toEqual(
        [],
    )
})

test('a value that is only a comment is not reported', () => {
    // `key:` with nothing but a comment after it is a null value the user wrote on purpose.
    expect(findCommentTruncations('filters: # todo\n')).toEqual([])
})

test('a nested key reports its own key name and line', () => {
    const text = ['views:', '  - type: table', '    filters: x == " #a"'].join(
        '\n',
    )
    expect(findCommentTruncations(text)).toEqual([
        { key: 'filters', line: 3, kept: 'x == "', dropped: '#a"' },
    ])
})

test('a sequence item value is reported under its key', () => {
    const text = 'where: tag == " #x"\nfrom: "[[Keep]]"\n'
    expect(findCommentTruncations(text).map(t => t.key)).toEqual(['where'])
})

test('a tab before the hashtag counts too', () => {
    const found = findCommentTruncations('filters: a\t#b\n')
    expect(found).toHaveLength(1)
    expect(found[0].dropped).toBe('#b')
})

test('the detector reports EVERY affected line, not just the first', () => {
    const text = 'a: x " #1"\nb: y " #2"\n'
    expect(findCommentTruncations(text).map(t => t.line)).toEqual([1, 2])
})

// `and`/`or`/`not` filter trees (FilterNode, core/src/bases/types.ts) write each leaf as a
// BARE sequence item with no colon of its own — `KEY_LINE` never sees one, so these leaves
// need their own detection path, keyed by the nearest enclosing `and:`/`or:`/`filters:` line.

test('a truncated leaf inside an `and:` tree is reported under `and`', () => {
    const text = [
        'filters:',
        '  and:',
        '    - tags.contains(" #book")',
        '    - status == "active"',
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([
        { key: 'and', line: 3, kept: 'tags.contains("', dropped: '#book")' },
    ])
})

test('a truncated leaf inside an `or:` tree is reported under `or`', () => {
    const text = [
        'filters:',
        '  or:',
        '    - status == "active"',
        '    - tags.contains(" #book")',
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([
        { key: 'or', line: 4, kept: 'tags.contains("', dropped: '#book")' },
    ])
})

test('a quoted leaf inside an `and:` tree is not truncated', () => {
    const text = [
        'filters:',
        '  and:',
        `    - 'tags.contains(" #book")'`,
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([])
})

test('a leaf hashtag with no preceding space is NOT a comment, even as a bare item', () => {
    const text = [
        'filters:',
        '  and:',
        '    - tags.contains("#book")',
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([])
})

test('a truncated key: value line and a truncated sequence item are BOTH reported', () => {
    const text = [
        'a: x " #1"',
        'filters:',
        '  and:',
        '    - tags.contains(" #book")',
    ].join('\n')
    const found = findCommentTruncations(text)
    expect(found.map(t => t.key)).toEqual(['a', 'and'])
    expect(found.map(t => t.line)).toEqual([1, 4])
})

// YAML permits a block sequence FLUSH with the key that introduces it — `and:` then `- item`
// at the SAME indent as `and:` itself, not deeper — and the real parser treats it identically
// to the more-indented spelling. An indent-stack that pops a frame on `indent >= frame.indent`
// unconditionally cannot tell "a sibling key ending this block" from "the next item of THIS
// block", and gets the flush case wrong in two different ways depending on nesting depth.

test('a flush-indent (not deeper) sequence under a nested key is still reported under that key', () => {
    // Regression guard for a real bug: an unconditional `>=` pop misattributed this to
    // `filters` instead of `and`, because the item's indent (2) equals `and:`'s indent (2).
    const text = [
        'filters:',
        '  and:',
        '  - tags.contains(" #book")',
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([
        { key: 'and', line: 3, kept: 'tags.contains("', dropped: '#book")' },
    ])
})

test('a flush-indent TOP-LEVEL sequence is reported, not silently dropped', () => {
    // Regression guard for the worse half of the same bug: an unconditional `>=` pop closed
    // the only frame on the stack (indent 0 >= 0) before the bare item was ever read, so the
    // truncation vanished with nothing reported at all.
    const text = ['and:', '- tags.contains(" #book")'].join('\n')
    expect(findCommentTruncations(text)).toEqual([
        { key: 'and', line: 2, kept: 'tags.contains("', dropped: '#book")' },
    ])
})

test('the deeper-indented tree style keeps working exactly as before (no regression)', () => {
    const text = [
        'filters:',
        '  and:',
        '    - tags.contains(" #book")',
    ].join('\n')
    expect(findCommentTruncations(text)).toEqual([
        { key: 'and', line: 3, kept: 'tags.contains("', dropped: '#book")' },
    ])
})

test('a document mixing flush and deeper-indented sequence styles reports both correctly', () => {
    const text = [
        'and:',
        '- tags.contains(" #book")',
        'filters:',
        '  or:',
        '    - status == "active"',
        '    - tags.contains(" #zap")',
    ].join('\n')
    const found = findCommentTruncations(text)
    expect(found.map(t => t.key)).toEqual(['and', 'or'])
    expect(found.map(t => t.line)).toEqual([2, 6])
})
