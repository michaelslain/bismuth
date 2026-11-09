// Prebuild step: compile bismuth-vision (app/src-tauri/vision/main.swift), the helper core runs to
// read handwriting and scans on-device with Apple's Vision framework.
//
// Like bismuth-notify it is an externalBin: Tauri resolves it by a target-triple suffix, copies it
// into Bismuth.app/Contents/MacOS and signs it with the app, so the output is
// `binaries/bismuth-vision-<triple>` (gitignored).
//
// Off macOS there is nothing to compile, but Tauri still requires every externalBin to exist, so a
// stub that exits 1 is written instead.
//
// Run: cd app && bun run scripts/build-vision.ts   (or `bun run build:vision`)
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertBuiltBinary, targetTriple } from './buildUtils'

const appDir = join(import.meta.dir, '..')
const source = join(appDir, 'src-tauri', 'vision', 'main.swift')
// Embedded as the binary's __info_plist section. In Contents/MacOS macOS otherwise takes each run
// for the app and shows it on screen; this marks the helper background-only before its first line.
const infoPlist = join(appDir, 'src-tauri', 'vision', 'Info.plist')
const outDir = join(appDir, 'src-tauri', 'binaries')
const outFile = join(outDir, `bismuth-vision-${targetTriple()}`)
mkdirSync(outDir, { recursive: true })

if (process.platform !== 'darwin') {
    writeFileSync(outFile, '#!/bin/sh\nexit 1\n')
    chmodSync(outFile, 0o755)
    console.log(`wrote vision stub → ${outFile}`)
    process.exit(0)
}

console.log(`compiling vision helper → ${outFile}`)
const build = spawnSync(
    'swiftc',
    ['-O', source, '-o', outFile, ...['-sectcreate', '__TEXT', '__info_plist', infoPlist].flatMap(a => ['-Xlinker', a])],
    { stdio: 'inherit' },
)
if (build.status !== 0) {
    console.error('swiftc failed (Xcode command line tools: xcode-select --install)')
    process.exit(1)
}
assertBuiltBinary(outFile, 'vision helper', 10_000)
