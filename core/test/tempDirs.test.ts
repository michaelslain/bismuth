import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sweepList, tempDir, trackedTempDirCount } from './tempDirs'

// Guards the fix for a leak that reached 9,255 dirs (~106MB) in /var/folders: test files were
// calling mkdtempSync directly, so nothing ever removed what they made.

test('tempDir tracks every dir it hands out', () => {
    const before = trackedTempDirCount()
    const a = tempDir('bismuth-tdtest-a-')
    const b = tempDir('bismuth-tdtest-b-')
    expect(existsSync(a)).toBe(true)
    expect(existsSync(b)).toBe(true)
    expect(trackedTempDirCount()).toBe(before + 2)
})

test('sweepList removes the dirs AND their contents, and empties the list', () => {
    // Own list, not the shared registry — see sweepList's docstring.
    const dirs = [
        mkdtempSync(join(tmpdir(), 'bismuth-tdtest-sweep1-')),
        mkdtempSync(join(tmpdir(), 'bismuth-tdtest-sweep2-')),
    ]
    // Non-empty, because `rmSync` without `recursive` would pass on empty dirs and fail here —
    // the assertion has to be able to catch a sweep that only handles the trivial case.
    writeFileSync(join(dirs[0]!, 'note.md'), '# not empty\n')
    expect(dirs.every(existsSync)).toBe(true)

    const copy = [...dirs]
    sweepList(dirs)

    expect(dirs.length).toBe(0)
    for (const d of copy) expect(existsSync(d)).toBe(false)
})

test('sweepList tolerates an already-removed dir without throwing', () => {
    const gone = mkdtempSync(join(tmpdir(), 'bismuth-tdtest-gone-'))
    const list = [gone, gone] // same path twice: second removal must be a no-op, not an error
    expect(() => sweepList(list)).not.toThrow()
    expect(existsSync(gone)).toBe(false)
})
