// Tests for the pure half of core/src/chatProviders/opencode/opencodeCli.ts: the version parse and
// the per-major argv rewrite. Version strings and v2 flags captured live from opencode 2.0.32.
import { describe, expect, test } from 'bun:test'
import {
    opencodeCliArgs,
    parseOpencodeMajor,
    usesBackgroundService,
} from '../../src/chatProviders/opencode/opencodeCli'

describe('parseOpencodeMajor', () => {
    test('reads v-prefixed and bare versions', () => {
        expect(parseOpencodeMajor('opencode v2.0.32\n')).toBe(2)
        expect(parseOpencodeMajor('1.18.4\n')).toBe(1)
    })

    test('nothing version-shaped is null', () => {
        expect(parseOpencodeMajor('')).toBeNull()
        expect(parseOpencodeMajor('command not found')).toBeNull()
    })
})

describe('usesBackgroundService', () => {
    test('major 2 and up ride the service; 1 and unknown do not', () => {
        expect(usesBackgroundService(2)).toBe(true)
        expect(usesBackgroundService(3)).toBe(true)
        expect(usesBackgroundService(1)).toBe(false)
        expect(usesBackgroundService(null)).toBe(false)
    })
})

describe('opencodeCliArgs', () => {
    const run = [
        'run',
        '--format',
        'json',
        '--auto',
        '-s',
        'ses_1',
        '-m',
        'mock/mock',
    ]

    test('v1 and an unknown version pass every call through unchanged', () => {
        for (const major of [1, null]) {
            expect(opencodeCliArgs(major, [...run, 'hi'])).toEqual([
                ...run,
                'hi',
            ])
            expect(opencodeCliArgs(major, ['export', 'ses_1'])).toEqual([
                'export',
                'ses_1',
            ])
            expect(opencodeCliArgs(major, ['debug', 'config'])).toEqual([
                'debug',
                'config',
            ])
            expect(opencodeCliArgs(major, ['models', '--verbose'])).toEqual([
                'models',
                '--verbose',
            ])
        }
    })

    test('v2 gives every server-backed call a private server', () => {
        expect(opencodeCliArgs(2, run)).toEqual([
            'run',
            '--standalone',
            ...run.slice(1),
        ])
        expect(opencodeCliArgs(2, ['models'])).toEqual([
            'models',
            '--standalone',
        ])
        expect(opencodeCliArgs(2, ['auth', 'list'])).toEqual([
            'auth',
            'list',
            '--standalone',
        ])
        expect(opencodeCliArgs(2, ['session', 'delete', 'ses_1'])).toEqual([
            'session',
            'delete',
            'ses_1',
            '--standalone',
        ])
    })

    test('v2 maps export to session export', () => {
        expect(opencodeCliArgs(2, ['export', 'ses_1'])).toEqual([
            'session',
            'export',
            'ses_1',
            '--standalone',
        ])
    })

    test('v2 skips calls with no safe equivalent', () => {
        expect(opencodeCliArgs(2, ['models', '--verbose'])).toBeNull()
        expect(opencodeCliArgs(2, ['debug', 'config'])).toBeNull()
        expect(opencodeCliArgs(2, [...run, '--command', 'init'])).toBeNull()
    })
})
