// Shared helpers for the app/scripts/build-*.ts prebuild steps.
import { existsSync, statSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// A stranded scratch file is only swept once it is this old. No compile in this repo takes
// anywhere near ten minutes (core is the biggest at ~68MB and finishes in well under a second),
// so the window cannot race a build running in parallel — `tauri build` fires several of these
// scripts, and `bun run installer` fires more.
//
// BISMUTH_BUNBUILD_SWEEP_MS overrides it. That exists so the sweep is testable without waiting ten
// minutes: ctime is the only trustworthy age field here (see sweep) and ctime cannot be backdated,
// so a test has to move the threshold rather than the file. Set it to 0 to sweep everything.
const SWEEP_AFTER_MS = Number(
    process.env.BISMUTH_BUNBUILD_SWEEP_MS ?? 10 * 60 * 1000,
)

// Where a `bun build --compile` child process should run.
//
// bun writes its compile scratch file — `.<hash>-<n>.bun-build`, a FULL ~60MB standalone binary,
// not a small temp — next to the process CWD, then renames it onto `--outfile` at the end. So an
// interrupted compile (Ctrl-C, a failed cross-compile, a killed `tauri build`) strands the whole
// binary, and because the hash is different every run they never overwrite each other: they just
// accumulate. Every build script here used to pass `cwd: repoRoot`, which is how 48 of them —
// 2.8GB — piled up in the repo root unnoticed.
//
// Pointing every compile at one directory does not stop the stranding (only bun can fix that), but
// it confines it: `.bun-build/` is gitignored, nothing reads it, and it can be deleted wholesale at
// any time without checking what is in it.
//
// It deliberately lives INSIDE the repo rather than in /tmp. The last step of a compile is a rename
// onto `--outfile`, which is only atomic within a single filesystem; a /tmp scratch dir on a
// separate volume would silently degrade that into a cross-device copy of a 60MB file.
export function compileCwd(repoRoot: string): string {
    const dir = join(repoRoot, '.bun-build')
    mkdirSync(dir, { recursive: true })
    sweep(dir)
    return dir
}

// Delete scratch files left behind by earlier runs.
//
// This is NOT belt-and-braces for the interrupted-build case the .gitignore describes: bun 1.4.0
// strands one on EVERY successful compile. Measured directly — three consecutive green builds left
// three 63.5MB files, one each. So without a sweep the directory grows by ~190MB per full
// `tauri build` forever, which is exactly how the repo root reached 2.8GB.
//
// Age is read from ctime, NOT mtime. bun produces the scratch by copying its own runtime binary
// and the copy preserves that binary's mtime, so every stray reports the date bun itself was
// installed — which is why the strays all looked like one bad afternoon rather than months of
// ordinary builds. ctime is the only field here that tracks when the file actually appeared.
function sweep(dir: string): void {
    const now = Date.now()
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.bun-build')) continue
        const path = join(dir, name)
        try {
            if (now - statSync(path).ctimeMs < SWEEP_AFTER_MS) continue
            rmSync(path, { force: true })
        } catch {
            // A concurrent build may have renamed it out from under us; nothing to do.
        }
    }
}

// Smoke-check a `bun build --compile` output: the file must exist and be non-trivial in size
// (a too-small binary usually means the compile silently produced a stub/error page instead of
// a real executable). Exits the process on failure; logs a success line with the size otherwise.
export function assertBuiltBinary(
    path: string,
    label: string,
    minBytes = 1_000_000,
): void {
    if (!existsSync(path) || statSync(path).size < minBytes) {
        console.error(`${label} missing or too small: ${path}`)
        process.exit(1)
    }
    console.log(
        `✓ ${label} built: ${path} (${(statSync(path).size / 1e6).toFixed(0)}MB)`,
    )
}
