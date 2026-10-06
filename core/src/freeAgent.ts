// core/src/freeAgent.ts — the one-click "free agent": download opencode's official release into
// FREE_AGENT_BIN_DIR so chat can run on opencode Zen's free models with no account.
//
// Fail-closed: the download is hashed while it streams and compared with the sha256 `digest` GitHub
// publishes on the release asset. A mismatch, a missing digest, a non-2xx or an archive with no
// `opencode` inside leaves NOTHING at the final path — the binary only appears via an atomic rename
// after every check passed.
import {
    chmodSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    renameSync,
    rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FREE_AGENT_BIN_DIR, whichBinary } from './claudeWhich'
import { AUTO_ORDER, BACKENDS, type BackendId } from './agentBackends/catalog'

export { FREE_AGENT_BIN_DIR }
export const OPENCODE_REPO = 'anomalyco/opencode'

export type FreeAgentPhase =
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'installing'
    | 'ready'
    | 'error'

export type FreeAgentProgress = {
    phase: FreeAgentPhase
    received?: number
    total?: number
    message?: string
    action?: 'installed' | 'already-installed'
    version?: string
    path?: string
}

export type FreeAgentStatus = {
    opencode: { installed: boolean; path: string | null; managed: boolean }
    claude: { installed: boolean }
    /** Every picker-visible backend in AUTO_ORDER, and whether its binary resolves here — what
     *  `chat.provider: auto` picks from, and the "or use one you have" row on the setup screen. */
    backends: { id: BackendId; label: string; installed: boolean }[]
    progress: FreeAgentProgress
}

/** The ids in AUTO_ORDER whose binary resolves on the augmented PATH (managed bin dir included). */
export function installedBackendIds(
    which: (name: string) => string | null = whichBinary,
): BackendId[] {
    return AUTO_ORDER.filter(id => !!which(BACKENDS[id].binary))
}

export type FreeAgentIO = {
    fetch: typeof fetch
    which: (name: string) => string | null
    exec: (
        cmd: string[],
        opts?: { timeoutMs?: number },
    ) => Promise<{ code: number; stdout: string; stderr: string }>
    platform: string
    arch: string
    binDir: string
    tmpDir: string
    idleTimeoutMs?: number
    totalTimeoutMs?: number
}

const NO_BUILD = 'opencode has no build for this platform'

export function assetForPlatform(platform: string, arch: string): string | null {
    if (arch !== 'arm64' && arch !== 'x64') return null
    if (platform === 'darwin') return `opencode-darwin-${arch}.zip`
    if (platform === 'linux') return `opencode-linux-${arch}.tar.gz`
    return null
}

export function pickReleaseAsset(
    release: unknown,
    asset: string,
): { url: string; sha256: string; size: number; version: string } | null {
    if (!release || typeof release !== 'object') return null
    const r = release as { tag_name?: unknown; assets?: unknown }
    if (!Array.isArray(r.assets)) return null
    const a = r.assets.find(
        x => x && typeof x === 'object' && (x as { name?: unknown }).name === asset,
    ) as
        | {
              size?: unknown
              browser_download_url?: unknown
              digest?: unknown
          }
        | undefined
    if (!a) return null
    const m =
        typeof a.digest === 'string' ? /^sha256:([0-9a-f]+)$/i.exec(a.digest) : null
    const hex = m?.[1] ?? null
    if (!hex || typeof a.browser_download_url !== 'string') return null
    return {
        url: a.browser_download_url,
        sha256: hex.toLowerCase(),
        size: typeof a.size === 'number' ? a.size : 0,
        version: typeof r.tag_name === 'string' ? r.tag_name.replace(/^v/, '') : '',
    }
}

async function defaultExec(
    cmd: string[],
    opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
        const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
        const timer = opts?.timeoutMs
            ? setTimeout(() => proc.kill(), opts.timeoutMs)
            : undefined
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        if (timer) clearTimeout(timer)
        return { code, stdout, stderr }
    } catch (e) {
        return { code: 127, stdout: '', stderr: (e as Error).message }
    }
}

function resolveIO(io?: Partial<FreeAgentIO>): FreeAgentIO {
    return {
        fetch: io?.fetch ?? fetch,
        which: io?.which ?? whichBinary,
        exec: io?.exec ?? defaultExec,
        platform: io?.platform ?? process.platform,
        arch: io?.arch ?? process.arch,
        binDir: io?.binDir ?? FREE_AGENT_BIN_DIR,
        tmpDir: io?.tmpDir ?? join(homedir(), '.bismuth', 'tmp'),
        idleTimeoutMs: io?.idleTimeoutMs ?? 30_000,
        totalTimeoutMs: io?.totalTimeoutMs ?? 600_000,
    }
}

let current: FreeAgentProgress = { phase: 'idle' }
let inflight: Promise<FreeAgentProgress> | null = null

// `opencode` at the top of an extracted archive, or one directory down.
function findBinary(dir: string): string | null {
    const top = join(dir, 'opencode')
    if (lstatSync(top, { throwIfNoEntry: false })?.isFile()) return top
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const nested = join(dir, e.name, 'opencode')
        if (lstatSync(nested, { throwIfNoEntry: false })?.isFile()) return nested
    }
    return null
}

export async function installFreeAgent(
    ioIn?: Partial<FreeAgentIO>,
    onProgress?: (p: FreeAgentProgress) => void,
): Promise<FreeAgentProgress> {
    const io = resolveIO(ioIn)
    const emit = (p: FreeAgentProgress): FreeAgentProgress => {
        current = p
        onProgress?.(p)
        return p
    }
    const fail = (message: string) => emit({ phase: 'error', message })

    const existing = io.which('opencode')
    if (existing) {
        const v = await io.exec([existing, '--version'], { timeoutMs: 15000 })
        if (v.code === 0) {
            return emit({
                phase: 'ready',
                action: 'already-installed',
                path: existing,
                ...(v.stdout.trim() ? { version: v.stdout.trim() } : {}),
            })
        }
        // a broken binary we put there ourselves is replaced; anyone else's is reported
        if (!existing.startsWith(io.binDir + '/'))
            return fail(`opencode is installed but did not run: ${v.stderr.trim()}`)
        rmSync(existing, { force: true })
    }

    const asset = assetForPlatform(io.platform, io.arch)
    if (!asset) return fail(NO_BUILD)

    let work: string | null = null
    const ctrl = new AbortController()
    let idle: ReturnType<typeof setTimeout> | undefined
    const armIdle = () => {
        clearTimeout(idle)
        idle = setTimeout(
            () => ctrl.abort(new Error('download stalled, no data received')),
            io.idleTimeoutMs,
        )
    }
    const total_ = setTimeout(
        () => ctrl.abort(new Error('download took too long')),
        io.totalTimeoutMs,
    )
    try {
        emit({ phase: 'downloading', received: 0 })
        const relRes = await io.fetch(
            `https://api.github.com/repos/${OPENCODE_REPO}/releases/latest`,
            {
                headers: { Accept: 'application/vnd.github+json' },
                signal: AbortSignal.timeout(30_000),
            },
        )
        if (!relRes.ok) return fail(`release lookup failed (HTTP ${relRes.status})`)
        const pick = pickReleaseAsset(await relRes.json(), asset)
        if (!pick) return fail('release has no verifiable download for this platform')

        mkdirSync(io.tmpDir, { recursive: true })
        work = mkdtempSync(join(io.tmpDir, 'opencode-'))
        const archive = join(work, asset)

        armIdle()
        const res = await io.fetch(pick.url, { signal: ctrl.signal })
        if (!res.ok || !res.body) return fail(`download failed (HTTP ${res.status})`)
        const total = Number(res.headers.get('content-length')) || pick.size || undefined
        const hasher = new Bun.CryptoHasher('sha256')
        const sink = Bun.file(archive).writer()
        let received = 0
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            hasher.update(chunk)
            sink.write(chunk)
            received += chunk.length
            armIdle()
            emit({ phase: 'downloading', received, total })
        }
        clearTimeout(idle)
        await sink.end()

        emit({ phase: 'verifying', received, total })
        if (hasher.digest('hex') !== pick.sha256)
            return fail('checksum mismatch, refusing to install the download')

        emit({ phase: 'installing', received, total })
        const outDir = join(work, 'out')
        mkdirSync(outDir)
        const extract = asset.endsWith('.zip')
            ? ['unzip', '-o', '-q', archive, '-d', outDir]
            : ['tar', '-xzf', archive, '-C', outDir]
        const ex = await io.exec(extract, { timeoutMs: 60000 })
        if (ex.code !== 0) return fail(`could not unpack the download: ${ex.stderr.trim()}`)
        const found = findBinary(outDir)
        if (!found) return fail('the download did not contain an opencode binary')

        chmodSync(found, 0o755)
        if (io.platform === 'darwin')
            await io
                .exec(['xattr', '-d', 'com.apple.quarantine', found], { timeoutMs: 15000 })
                .catch(() => null)
        mkdirSync(io.binDir, { recursive: true })
        const dest = join(io.binDir, 'opencode')
        renameSync(found, dest)

        const v = await io.exec([dest, '--version'], { timeoutMs: 15000 })
        if (v.code !== 0) {
            rmSync(dest, { force: true })
            return fail(`the installed opencode did not run: ${v.stderr.trim()}`)
        }
        return emit({
            phase: 'ready',
            action: 'installed',
            version: v.stdout.trim(),
        })
    } catch (e) {
        return fail((e as Error).message || String(e))
    } finally {
        clearTimeout(idle)
        clearTimeout(total_)
        if (work) rmSync(work, { recursive: true, force: true })
    }
}

export function startFreeAgentInstall(
    io?: Partial<FreeAgentIO>,
): FreeAgentProgress {
    if (inflight) return current
    current = { phase: 'idle' }
    inflight = installFreeAgent(io).finally(() => {
        inflight = null
    })
    return current
}

export function getFreeAgentStatus(ioIn?: Partial<FreeAgentIO>): FreeAgentStatus {
    const io = resolveIO(ioIn)
    const path = io.which('opencode')
    return {
        opencode: {
            installed: !!path,
            path,
            managed: !!path && path.startsWith(io.binDir + '/'),
        },
        claude: { installed: !!io.which('claude') },
        backends: AUTO_ORDER.map(id => ({
            id,
            label: BACKENDS[id].label,
            installed: !!io.which(BACKENDS[id].binary),
        })),
        progress: current,
    }
}
