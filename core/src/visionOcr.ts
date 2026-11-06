// core/src/visionOcr.ts
// On-device handwriting and scan recognition: runs the bundled `bismuth-vision` helper (Apple
// Vision, app/src-tauri/vision/main.swift) over an image or a pdf and returns text per page.
// Reached only through a dynamic import() from the book route, never statically: it needs
// node:child_process and node:fs, which the iPad's in-process core does not have.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bismuthHome } from './bismuthHome'
import { AppError } from './error'

/** One recognised line; x, y, w, h are fractions of the page (0..1), origin top-left. */
export type TextLine = { text: string; x: number; y: number; w: number; h: number }

/** One recognised page; confidence (0..1) is the mean over its lines, absent when not reported. */
export type RecognizedPage = { page: number; text: string; confidence?: number }

const TIMEOUT_MS = 120_000

let cached: string | null | undefined

/** Forget the located helper so the next call looks again (tests). */
export function resetVisionHelperCache(): void {
    cached = undefined
}

function triple(): string {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
}

/** Where the helper is: BISMUTH_VISION_PATH, the app bundle's MacOS dir (BISMUTH_APP_PATH, set by
 *  the Tauri shell), the dev build in app/src-tauri/binaries, then (darwin with swiftc) a build of
 *  app/src-tauri/vision/main.swift cached in ~/.bismuth/cache/vision, compiled on first use. Null
 *  when none exists. The first hit is cached for the process. */
export function findVisionHelper(): string | null {
    if (cached) return cached
    const candidates = [
        process.env.BISMUTH_VISION_PATH,
        process.env.BISMUTH_APP_PATH
            ? join(process.env.BISMUTH_APP_PATH, 'Contents', 'MacOS', 'bismuth-vision')
            : undefined,
        join(import.meta.dir, '..', '..', 'app', 'src-tauri', 'binaries', `bismuth-vision-${triple()}`),
    ]
    for (const c of candidates) {
        if (c && existsSync(c)) {
            cached = c
            return c
        }
    }
    if (process.platform === 'darwin' && Bun.which('swiftc')) {
        const source = join(import.meta.dir, '..', '..', 'app', 'src-tauri', 'vision', 'main.swift')
        if (existsSync(source)) {
            const sha8 = new Bun.CryptoHasher('sha1').update(readFileSync(source)).digest('hex').slice(0, 8)
            const out = bismuthHome('cache', 'vision', `bismuth-vision-${sha8}`)
            if (!existsSync(out)) {
                mkdirSync(dirname(out), { recursive: true })
                const r = spawnSync('swiftc', ['-O', source, '-o', out], { stdio: 'ignore' })
                if (r.status !== 0) return null
            }
            cached = out
            return out
        }
    }
    return null
}

/** Run the helper and parse its one JSON array. */
async function runHelper(file: string, extra: string[], opts: { pages?: number[]; timeoutMs?: number }): Promise<unknown[]> {
    const helper = findVisionHelper()
    if (!helper) {
        throw new AppError('VISION_UNAVAILABLE', 'on-device text recognition is not available here', 503)
    }
    const args = [helper, file, ...extra]
    if (opts.pages?.length) args.push('--pages', opts.pages.join(','))
    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? TIMEOUT_MS)
    try {
        const [out, err, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        if (code !== 0) {
            throw new AppError(
                'VISION_FAILED',
                `text recognition failed: ${err.trim() || `exit ${code}`}`,
                500,
            )
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(out)
        } catch {
            throw new AppError('VISION_FAILED', 'text recognition returned unreadable output', 500)
        }
        if (!Array.isArray(parsed)) {
            throw new AppError('VISION_FAILED', 'text recognition returned unreadable output', 500)
        }
        return parsed
    } finally {
        clearTimeout(timer)
    }
}

/** Recognise `file` (image or pdf, absolute path). `pages` limits a pdf to those 1-based pages. */
export async function recognizePages(
    file: string,
    opts: { pages?: number[]; timeoutMs?: number } = {},
): Promise<RecognizedPage[]> {
    const parsed = await runHelper(file, [], opts)
    return (parsed as { page?: unknown; text?: unknown; confidence?: unknown }[])
        .filter(p => typeof p?.page === 'number' && typeof p?.text === 'string')
        .map(p => {
            const page: RecognizedPage = { page: p.page as number, text: p.text as string }
            if (typeof p.confidence === 'number' && Number.isFinite(p.confidence)) page.confidence = p.confidence
            return page
        })
}

/** Write each page of `file` (image or pdf) to `outDir/page-<n>.png`; returns the written paths. */
export async function renderPages(
    file: string,
    outDir: string,
    opts: { pages?: number[]; timeoutMs?: number } = {},
): Promise<{ page: number; path: string }[]> {
    const parsed = await runHelper(file, ['--render', outDir], opts)
    return (parsed as { page?: unknown; path?: unknown }[])
        .filter(p => typeof p?.page === 'number' && typeof p?.path === 'string')
        .map(p => ({ page: p.page as number, path: p.path as string }))
}

/** Like recognizePages, but each page carries its lines with boxes (fractions, top-left origin). */
export async function recognizeLines(
    file: string,
    opts: { pages?: number[]; timeoutMs?: number } = {},
): Promise<{ page: number; lines: TextLine[] }[]> {
    const parsed = await runHelper(file, ['--lines'], opts)
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return (parsed as { page?: unknown; lines?: unknown }[])
        .filter(p => typeof p?.page === 'number' && Array.isArray(p?.lines))
        .map(p => ({
            page: p.page as number,
            lines: (p.lines as Record<string, unknown>[])
                .filter(l => typeof l?.text === 'string')
                .map(l => ({ text: l.text as string, x: num(l.x), y: num(l.y), w: num(l.w), h: num(l.h) })),
        }))
}
