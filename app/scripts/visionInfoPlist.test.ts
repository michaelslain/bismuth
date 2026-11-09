// bismuth-vision sits in Bismuth.app/Contents/MacOS, so macOS takes each run for the app and shows
// it on screen unless the helper says otherwise. Both halves of that are pinned here: the plist
// embedded at build time (macOS reads it before the helper's first line) and the policy the
// helper sets for builds that run without it.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appDir = join(import.meta.dir, '..')
const read = (...p: string[]) => readFileSync(join(appDir, ...p), 'utf8')

test('the vision helper is marked background-only and the build embeds that', () => {
    expect(read('src-tauri', 'vision', 'Info.plist')).toMatch(/<key>LSBackgroundOnly<\/key>\s*<true\/>/)
    const build = read('scripts', 'build-vision.ts')
    expect(build).toContain("'__info_plist'")
    expect(build).toContain("'vision', 'Info.plist'")
})

test('the vision helper refuses a foreground presence before it touches AppKit', () => {
    const source = read('src-tauri', 'vision', 'main.swift')
    const policy = source.indexOf('setActivationPolicy(.prohibited)')
    expect(policy).toBeGreaterThan(-1)
    expect(policy).toBeLessThan(source.indexOf('NSSpellChecker.shared'))
})
