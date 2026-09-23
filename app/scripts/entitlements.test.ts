// A signed `tauri build` runs every executable under the hardened runtime, including the compiled
// bismuth-core sidecar. Without these two entitlements the installed app's terminal cannot load
// bun-pty's native library and its JavaScript runs with no JIT. Nothing in dev or the test suite
// signs a binary, so this is the only thing that notices if the wiring comes loose.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tauriDir = join(import.meta.dir, '..', 'src-tauri')
const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))

function grantedKeys(plist: string): string[] {
    const body = plist.replace(/<!--[\s\S]*?-->/g, '')
    return [...body.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map(m => m[1])
}

describe('macOS entitlements', () => {
    it('tauri.conf.json points bundle.macOS.entitlements at a file in src-tauri', () => {
        expect(conf.bundle.macOS?.entitlements).toBe('Entitlements.plist')
    })

    it('grants the sidecar JIT and lets it dlopen the extracted bun-pty library', () => {
        const plist = readFileSync(
            join(tauriDir, conf.bundle.macOS.entitlements),
            'utf8',
        )
        expect(grantedKeys(plist).sort()).toEqual([
            'com.apple.security.cs.allow-jit',
            'com.apple.security.cs.disable-library-validation',
        ])
    })
})
