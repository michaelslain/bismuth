// Subprocess probe for registry.test.ts: config.ts reads BISMUTH_DAEMON_DIR once at import, so the
// cache test runs here with its own env and prints one JSON line per step.
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { loadAllVaults, resetDaemonSettingsCache } from '../src/lib/registry.ts'

const root = process.argv[2]!
const settings = join(root, '.settings')
const identity = join(root, '.daemon', 'identity.md')
const at = (file: string, sec: number) => utimesSync(file, sec, sec)
const look = async () => {
    const [v] = await loadAllVaults()
    return { enabled: v!.enabled, name: v!.ctx.name }
}

mkdirSync(join(root, '.daemon'), { recursive: true })
writeFileSync(settings, 'daemon:\n    enabled: true\n')
writeFileSync(identity, '---\nname: Ada\n---\n')
at(settings, 1000)
at(identity, 1000)
resetDaemonSettingsCache()

const out: Record<string, unknown> = {}
out.first = await look()
// content changes but mtime is restored → the cache must serve the old value (no re-read)
writeFileSync(settings, 'daemon:\n    enabled: false\n')
at(settings, 1000)
out.unchangedMtime = await look()
// a real edit (mtime bumped) is seen on the next load
at(settings, 2000)
out.edited = await look()
// deleting identity.md falls back to the default name
rmSync(identity)
out.noIdentity = await look()
// legacy-shape-only vault: root settings.yaml is the sole settings file; editing it is picked up
rmSync(settings)
const legacy = join(root, 'settings.yaml')
writeFileSync(legacy, 'daemon:\n    enabled: false\n')
at(legacy, 1000)
resetDaemonSettingsCache()
out.legacyFirst = await look()
writeFileSync(legacy, 'daemon:\n    enabled: true\n')
at(legacy, 2000)
out.legacyEdited = await look()
console.log(JSON.stringify(out))
