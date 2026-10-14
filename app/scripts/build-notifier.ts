// Prebuild step: compile bismuth-notify (app/src-tauri/notifier/main.swift), the helper the daemon
// runs to post desktop notifications under Bismuth's name and icon.
//
// It is an externalBin, not a resource, because only a binary in Bismuth.app/Contents/MacOS gets
// the app's bundle identity — a resource in Contents/Resources posts as an unknown process. Tauri
// resolves externalBins by a target-triple suffix and signs them with the app, so the output is
// `binaries/bismuth-notify-<triple>` (gitignored, like bismuth-core).
//
// Off macOS there is nothing to compile (the daemon uses notify-send there), but Tauri still
// requires every externalBin to exist, so a stub that exits 1 is written instead.
//
// Run: cd app && bun run scripts/build-notifier.ts   (or `bun run build:notifier`)
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertBuiltBinary, targetTriple } from './buildUtils'

const appDir = join(import.meta.dir, '..')
const source = join(appDir, 'src-tauri', 'notifier', 'main.swift')
// Embedded as the binary's __info_plist section. codesign takes a standalone binary's identifier
// from it, and macOS refuses notifications from a helper whose signing identifier is not the
// app's bundle id (usernotificationsd: "requestAuthorization not allowed"). Without it Tauri
// signs the helper as plain `bismuth-notify`. Keep its CFBundleIdentifier equal to
// tauri.conf.json's `identifier`.
const infoPlist = join(appDir, 'src-tauri', 'notifier', 'Info.plist')
const outDir = join(appDir, 'src-tauri', 'binaries')
const outFile = join(outDir, `bismuth-notify-${targetTriple()}`)
mkdirSync(outDir, { recursive: true })

if (process.platform !== 'darwin') {
    writeFileSync(outFile, '#!/bin/sh\nexit 1\n')
    chmodSync(outFile, 0o755)
    console.log(`wrote notifier stub → ${outFile}`)
    process.exit(0)
}

console.log(`compiling notifier → ${outFile}`)
const build = spawnSync(
    'swiftc',
    [
        '-O',
        source,
        '-o',
        outFile,
        ...['-sectcreate', '__TEXT', '__info_plist', infoPlist].flatMap(a => [
            '-Xlinker',
            a,
        ]),
    ],
    { stdio: 'inherit' },
)
if (build.status !== 0) {
    console.error('swiftc failed (Xcode command line tools: xcode-select --install)')
    process.exit(1)
}
assertBuiltBinary(outFile, 'notifier', 10_000)
