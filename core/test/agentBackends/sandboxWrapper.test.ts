import { test, expect, describe } from 'bun:test'
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    buildSeatbeltProfile,
    wrapArgv,
    materializeSandboxProfile,
    checkSandboxWrapperAvailability,
    sandboxWrapperAvailable,
    describeSandboxWrapperUnavailable,
    isSandboxApplyFailure,
    SANDBOX_APPLY_FAILURE_EXIT_CODE,
} from '../../src/agentBackends/sandboxWrapper'

describe('buildSeatbeltProfile', () => {
    test('permissive-except header, one subpath deny per path', () => {
        const profile = buildSeatbeltProfile([
            '/vault/secret.md',
            '/vault/.git',
        ])
        expect(profile).toContain('(version 1)')
        expect(profile).toContain('(allow default)')
        expect(profile).toContain('(deny file-read* (subpath "/vault/.git"))')
        expect(profile).toContain(
            '(deny file-read* (subpath "/vault/secret.md"))',
        )
    })

    test('empty input still yields a valid (harmless) permissive profile', () => {
        const profile = buildSeatbeltProfile([])
        expect(profile).toBe('(version 1)\n(allow default)\n')
    })

    test('deduplicates and sorts — same logical set is byte-identical regardless of input order', () => {
        const a = buildSeatbeltProfile([
            '/vault/b.md',
            '/vault/a.md',
            '/vault/b.md',
        ])
        const b = buildSeatbeltProfile(['/vault/a.md', '/vault/b.md'])
        expect(a).toBe(b)
    })

    test('escapes double quotes and backslashes in a path', () => {
        const profile = buildSeatbeltProfile([
            '/vault/weird "quoted" \\ name.md',
        ])
        expect(profile).toContain(
            '(deny file-read* (subpath "/vault/weird \\"quoted\\" \\\\ name.md"))',
        )
    })

    test('handles a path with spaces and non-ASCII characters verbatim (no extra escaping needed)', () => {
        const profile = buildSeatbeltProfile([
            '/vault/naïve folder/secret été.md',
        ])
        expect(profile).toContain(
            '(subpath "/vault/naïve folder/secret été.md")',
        )
    })
})

describe('wrapArgv', () => {
    test('returns argv UNCHANGED when profilePath is null', () => {
        expect(wrapArgv(['opencode', 'run', 'hi'], null)).toEqual([
            'opencode',
            'run',
            'hi',
        ])
    })

    test('prefixes sandbox-exec -f <profile> when a profile path is given', () => {
        expect(
            wrapArgv(
                ['opencode', 'run', 'hi'],
                '/vault/.daemon/tmp/visibility-abc123.sb',
            ),
        ).toEqual([
            '/usr/bin/sandbox-exec',
            '-f',
            '/vault/.daemon/tmp/visibility-abc123.sb',
            'opencode',
            'run',
            'hi',
        ])
    })

    test('honors a custom sandbox-exec path (test seam)', () => {
        expect(wrapArgv(['x'], '/p.sb', '/custom/sandbox-exec')).toEqual([
            '/custom/sandbox-exec',
            '-f',
            '/p.sb',
            'x',
        ])
    })

    test('never mutates the input array', () => {
        const argv = ['opencode', 'run']
        wrapArgv(argv, '/p.sb')
        expect(argv).toEqual(['opencode', 'run'])
    })
})

describe('checkSandboxWrapperAvailability / sandboxWrapperAvailable', () => {
    test('P1: unavailable on a non-darwin platform, even with sandbox-exec present', () => {
        const r = checkSandboxWrapperAvailability({
            platform: 'linux',
            sandboxExecPath: __filename,
        })
        expect(r).toEqual({ available: false, reason: 'unsupported-platform' })
        expect(
            sandboxWrapperAvailable({
                platform: 'linux',
                sandboxExecPath: __filename,
            }),
        ).toBe(false)
    })

    test('P2: unavailable when the backend self-sandboxes, even on darwin with sandbox-exec present', () => {
        const r = checkSandboxWrapperAvailability({
            platform: 'darwin',
            sandboxExecPath: __filename,
            selfSandboxes: true,
        })
        expect(r).toEqual({
            available: false,
            reason: 'backend-self-sandboxes',
        })
    })

    test('P1: unavailable when sandbox-exec is missing on darwin', () => {
        const r = checkSandboxWrapperAvailability({
            platform: 'darwin',
            sandboxExecPath: '/does/not/exist/sandbox-exec',
        })
        expect(r).toEqual({ available: false, reason: 'sandbox-exec-missing' })
    })

    test('available: darwin + sandbox-exec present + not self-sandboxing', () => {
        const r = checkSandboxWrapperAvailability({
            platform: 'darwin',
            sandboxExecPath: __filename,
            selfSandboxes: false,
        })
        expect(r).toEqual({ available: true })
        expect(
            sandboxWrapperAvailable({
                platform: 'darwin',
                sandboxExecPath: __filename,
            }),
        ).toBe(true)
    })

    test('defaults consult the real process.platform / SANDBOX_EXEC_PATH when opts are omitted', () => {
        // Just asserts it doesn't throw and returns a well-shaped result on THIS machine.
        const r = checkSandboxWrapperAvailability()
        expect(typeof r.available).toBe('boolean')
    })
})

describe('describeSandboxWrapperUnavailable', () => {
    test('names a mechanism only for the specific reason given — never overclaims', () => {
        expect(
            describeSandboxWrapperUnavailable('unsupported-platform'),
        ).toMatch(/macOS/)
        expect(
            describeSandboxWrapperUnavailable('sandbox-exec-missing'),
        ).toMatch(/sandbox-exec/)
        expect(
            describeSandboxWrapperUnavailable('backend-self-sandboxes'),
        ).toMatch(/own OS sandbox/)
    })
})

describe('isSandboxApplyFailure', () => {
    test('true only for exit 71, false for null/undefined/other codes', () => {
        expect(isSandboxApplyFailure(SANDBOX_APPLY_FAILURE_EXIT_CODE)).toBe(
            true,
        )
        expect(isSandboxApplyFailure(71)).toBe(true)
        expect(isSandboxApplyFailure(0)).toBe(false)
        expect(isSandboxApplyFailure(1)).toBe(false)
        expect(isSandboxApplyFailure(null)).toBe(false)
        expect(isSandboxApplyFailure(undefined)).toBe(false)
    })
})

describe('materializeSandboxProfile', () => {
    test('returns null and writes nothing for an empty deny list', async () => {
        const vault = mkdtempSync(join(tmpdir(), 'bismuth-sandboxwrapper-'))
        const path = await materializeSandboxProfile(vault, [])
        expect(path).toBeNull()
        expect(existsSync(join(vault, '.daemon', 'tmp'))).toBe(false)
    })

    test('writes a 0600 profile file under <vault>/.daemon/tmp and returns its path', async () => {
        const vault = mkdtempSync(join(tmpdir(), 'bismuth-sandboxwrapper-'))
        const path = await materializeSandboxProfile(vault, [
            '/vault/secret.md',
        ])
        expect(path).not.toBeNull()
        expect(path as string).toMatch(
            /\.daemon\/tmp\/visibility-[0-9a-f]{16}\.sb$/,
        )
        const content = readFileSync(path as string, 'utf-8')
        expect(content).toContain(
            '(deny file-read* (subpath "/vault/secret.md"))',
        )
        const mode = statSync(path as string).mode & 0o777
        expect(mode).toBe(0o600)
    })

    test('content-addressed: the SAME deny set reuses the same file path across calls', async () => {
        const vault = mkdtempSync(join(tmpdir(), 'bismuth-sandboxwrapper-'))
        const a = await materializeSandboxProfile(vault, [
            '/vault/secret.md',
            '/vault/other.md',
        ])
        const b = await materializeSandboxProfile(vault, [
            '/vault/other.md',
            '/vault/secret.md',
        ]) // different order
        expect(a).toBe(b)
    })

    test('a different deny set produces a different file', async () => {
        const vault = mkdtempSync(join(tmpdir(), 'bismuth-sandboxwrapper-'))
        const a = await materializeSandboxProfile(vault, ['/vault/secret.md'])
        const b = await materializeSandboxProfile(vault, ['/vault/other.md'])
        expect(a).not.toBe(b)
    })
})
