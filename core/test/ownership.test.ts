import { describe, test, expect } from 'bun:test'
import {
    isBismuthOwnedPath,
    bismuthHomeOf,
    isOldHomeBismuthPath,
} from '../src/ownership'

describe('isBismuthOwnedPath', () => {
    test('current and old homes both match', () => {
        expect(
            isBismuthOwnedPath('/Users/m/.bismuth/skills/a', 'skills/a'),
        ).toBe(true)
        expect(
            isBismuthOwnedPath(
                '/Users/michaelslain/.bismuth/skills/a',
                'skills/a',
            ),
        ).toBe(true)
        expect(
            isBismuthOwnedPath('/home/u/.bismuth/bin/bismuth', 'bin/bismuth'),
        ).toBe(true)
    })
    test('segment-aligned only — a lookalike dir is foreign', () => {
        expect(
            isBismuthOwnedPath(
                '/Users/x/proj/.bismuth-notes/skills/a',
                'skills/a',
            ),
        ).toBe(false)
        expect(
            isBismuthOwnedPath('/Users/x/my.bismuth/skills/a', 'skills/a'),
        ).toBe(false)
        expect(
            isBismuthOwnedPath('/Users/m/.bismuth/skills/a-extra', 'skills/a'),
        ).toBe(false)
        expect(
            isBismuthOwnedPath(
                '/Users/m/.bismuth/bin/bismuth-mcp',
                'bin/bismuth',
            ),
        ).toBe(false)
    })
    test('trailing slash and relative-looking input', () => {
        expect(
            isBismuthOwnedPath('/Users/m/.bismuth/skills/a/', 'skills/a'),
        ).toBe(true)
        expect(isBismuthOwnedPath('skills/a', 'skills/a')).toBe(false)
    })
    test('absolute-only — a relative, escaping or empty-home path is never ours', () => {
        expect(isBismuthOwnedPath('proj/.bismuth/skills/a', 'skills/a')).toBe(
            false,
        )
        expect(isBismuthOwnedPath('../.bismuth/skills/a', 'skills/a')).toBe(
            false,
        )
        expect(isBismuthOwnedPath('/.bismuth/skills/a', 'skills/a')).toBe(false)
        expect(
            isBismuthOwnedPath('/x/.bismuth/skills/../../etc/a', 'skills/a'),
        ).toBe(false)
    })
})

describe('bismuthHomeOf / isOldHomeBismuthPath', () => {
    test('home is the part before /.bismuth/', () => {
        expect(bismuthHomeOf('/Users/michaelslain/.bismuth/bin/bismuth')).toBe(
            '/Users/michaelslain',
        )
        expect(bismuthHomeOf('/usr/local/bin/bismuth')).toBe(null)
        expect(bismuthHomeOf('proj/.bismuth/skills/a')).toBe(null)
        expect(bismuthHomeOf('/.bismuth/skills/a')).toBe(null)
    })
    test('old home vs current', () => {
        expect(
            isOldHomeBismuthPath(
                '/Users/michaelslain/.bismuth/bin/bismuth',
                'bin/bismuth',
                '/Users/m',
            ),
        ).toBe(true)
        expect(
            isOldHomeBismuthPath(
                '/Users/m/.bismuth/bin/bismuth',
                'bin/bismuth',
                '/Users/m',
            ),
        ).toBe(false)
    })
})
