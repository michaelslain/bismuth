// core/src/markerSetup.ts
// Install Marker, the local math reader, the first time it is needed, with no terminal: uv (the
// Python tool installer) as one downloaded binary, then marker-pdf through it, then llama.cpp's
// llama-server from its release. Everything lands under ~/.bismuth/tools (BISMUTH_TOOLS_DIR in
// tests), whose bin/ the engine lookup in marker.ts already searches. One install runs at a time,
// in the background; the app polls its state.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { MARKER_PDF_SPEC, findTool, runTool, stderrTail } from './marker'

/** Where the installed tools live; `bin/` holds what the engine lookup finds. */
export function toolsDir(env: Record<string, string | undefined> = process.env): string {
    return env.BISMUTH_TOOLS_DIR || join(env.HOME || homedir(), '.bismuth', 'tools')
}

/** The programs Marker needs, in install order. */
export const MARKER_TOOLS = ['marker_single', 'llama-server'] as const

export type MarkerSetupStep = 'uv' | 'marker' | 'llama-server'

export type MarkerSetupState =
    | { state: 'idle' }
    | { state: 'running'; step: MarkerSetupStep; startedAt: number }
    | { state: 'done'; startedAt: number; endedAt: number }
    | { state: 'failed'; step: MarkerSetupStep; error: string }

export type MarkerStatus = { installed: boolean; missing: string[]; job: MarkerSetupState }

/** What an install does, one function a step; each always installs. The job skips a step whose
 *  program is already found. Tests swap these; production downloads. */
export type MarkerSetupSteps = {
    uv: (dirs: SetupDirs) => Promise<string>
    marker: (uv: string, dirs: SetupDirs) => Promise<void>
    llama: (dirs: SetupDirs) => Promise<void>
}

export type SetupDirs = { root: string; bin: string }

const arch = () => (process.arch === 'arm64' ? 'aarch64' : 'x86_64')

async function download(url: string, to: string): Promise<void> {
    const res = await fetch(url, { headers: { 'User-Agent': 'bismuth-setup' } })
    if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`)
    writeFileSync(to, new Uint8Array(await res.arrayBuffer()))
}

async function run(bin: string, argv: string[], env: Record<string, string> = {}): Promise<void> {
    const r = await runTool(bin, argv, undefined, env)
    if (r.code !== 0) throw new Error(`${bin.split('/').pop()} exited ${r.code}: ${stderrTail(r.stderr, 3)}`)
}

/** The first file named `name` under `dir`, depth first. */
function findFile(dir: string, name: string): string | null {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) {
            const hit = findFile(p, name)
            if (hit) return hit
        } else if (entry === name) return p
    }
    return null
}

/** uv's arguments and environment for the marker step: marker-pdf 2.x, with a Python uv fetches
 *  for it; its commands land in bin/. */
export function markerInstall(dirs: SetupDirs): { argv: string[]; env: Record<string, string> } {
    return {
        argv: ['tool', 'install', MARKER_PDF_SPEC],
        env: {
            UV_TOOL_DIR: join(dirs.root, 'uv-tools'),
            UV_TOOL_BIN_DIR: dirs.bin,
            UV_PYTHON_INSTALL_DIR: join(dirs.root, 'python'),
        },
    }
}

export const realSteps: MarkerSetupSteps = {
    // uv's standalone release: one binary, no Python needed to run it.
    uv: async dirs => {
        const tmp = mkdtempSync(join(tmpdir(), 'bismuth-uv-'))
        try {
            const tgz = join(tmp, 'uv.tar.gz')
            await download(`https://github.com/astral-sh/uv/releases/latest/download/uv-${arch()}-apple-darwin.tar.gz`, tgz)
            await run('/usr/bin/tar', ['-xzf', tgz, '-C', tmp])
            const uv = findFile(tmp, 'uv')
            if (!uv) throw new Error('the uv download held no uv binary')
            const to = join(dirs.bin, 'uv')
            writeFileSync(to, new Uint8Array(await Bun.file(uv).arrayBuffer()))
            chmodSync(to, 0o755)
            return to
        } finally {
            rmSync(tmp, { recursive: true, force: true })
        }
    },
    marker: async (uv, dirs) => {
        const { argv, env } = markerInstall(dirs)
        await run(uv, argv, env)
    },
    // llama.cpp's macOS release; a small launcher in bin/ runs it from its own folder, where its
    // libraries sit.
    llama: async dirs => {
        const rel = (await (
            await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', { headers: { 'User-Agent': 'bismuth-setup' } })
        ).json()) as { assets?: { name: string; browser_download_url: string }[] }
        const want = `bin-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip`
        const asset = rel.assets?.find(a => a.name.endsWith(want))
        if (!asset) throw new Error(`no llama.cpp release for this Mac (${want})`)
        const dir = join(dirs.root, 'llama.cpp')
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        const zip = join(dir, 'llama.zip')
        await download(asset.browser_download_url, zip)
        await run('/usr/bin/unzip', ['-q', '-o', zip, '-d', dir])
        rmSync(zip, { force: true })
        const server = findFile(dir, 'llama-server')
        if (!server) throw new Error('the llama.cpp download held no llama-server')
        chmodSync(server, 0o755)
        const launcher = join(dirs.bin, 'llama-server')
        writeFileSync(launcher, `#!/bin/sh\nexec "${server}" "$@"\n`)
        chmodSync(launcher, 0o755)
    },
}

let job: MarkerSetupState = { state: 'idle' }
let steps: MarkerSetupSteps = realSteps

/** Test seam: replace the steps; null restores the real ones and clears the job. */
export function setMarkerSetupSteps(next: MarkerSetupSteps | null): void {
    steps = next ?? realSteps
    job = { state: 'idle' }
}

/** Whether Marker can run now, what is missing, and the install job's state. */
export function markerStatus(): MarkerStatus {
    const missing = MARKER_TOOLS.filter(t => !findTool(t))
    return { installed: missing.length === 0, missing, job }
}

/** Start installing in the background, unless it is installed or already installing; answers the
 *  state right after starting. Only on a Mac: elsewhere it fails at once with the install commands. */
export function startMarkerSetup(platform: NodeJS.Platform = process.platform): MarkerSetupState {
    if (job.state === 'running') return job
    if (markerStatus().installed) return (job = { state: 'done', startedAt: Date.now(), endedAt: Date.now() })
    if (platform !== 'darwin')
        return (job = { state: 'failed', step: 'uv', error: `the math reader installs itself only on a Mac; run: uv tool install '${MARKER_PDF_SPEC}' and install llama.cpp` })
    const startedAt = Date.now()
    const root = toolsDir()
    const dirs = { root, bin: join(root, 'bin') }
    mkdirSync(dirs.bin, { recursive: true })
    let step: MarkerSetupStep = 'uv'
    job = { state: 'running', step, startedAt }
    void (async () => {
        try {
            const uv = findTool('uv') ?? (await steps.uv(dirs))
            job = { state: 'running', step: (step = 'marker'), startedAt }
            if (!findTool('marker_single')) await steps.marker(uv, dirs)
            job = { state: 'running', step: (step = 'llama-server'), startedAt }
            if (!findTool('llama-server')) await steps.llama(dirs)
            job = { state: 'done', startedAt, endedAt: Date.now() }
        } catch (e) {
            job = { state: 'failed', step, error: e instanceof Error ? e.message : String(e) }
        }
    })()
    return job
}

/** True when `dir` holds an install this module made (for tests and the docs' cleanup line). */
export const hasToolsDir = (dir: string = toolsDir()): boolean => existsSync(join(dir, 'bin'))
