// bismuth-notify carries an embedded Info.plist (app/scripts/build-notifier.ts) so codesign gives it
// the app's bundle id as its signing identifier. macOS refuses notifications from a helper whose
// identifier differs from the bundle it sits in, so the two ids must never drift apart.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tauriDir = join(import.meta.dir, '..', 'src-tauri')

test("the notifier's embedded bundle id is the app's identifier", () => {
    const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
    const plist = readFileSync(join(tauriDir, 'notifier', 'Info.plist'), 'utf8')
    const id = plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
    expect(id).toBe(conf.identifier)
})
