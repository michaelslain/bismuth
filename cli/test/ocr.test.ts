import { describe, test, expect } from 'bun:test'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { makeVault } from '../../core/test/helpers'
import { shouldRunSlowTests } from '../../core/test/slowGate'
import {
    findTool,
    markerArgs,
    ocrmypdfArgs,
    parsePages,
    tidyMarkdown,
    toolPath,
} from '../src/ocr'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const FIXTURE = join(import.meta.dir, 'fixtures', 'ocr-watermark-scan.pdf')

describe('ocr argv shapes', () => {
    test('pages parse 1-based and refuse page 0 and backwards ranges', () => {
        expect(parsePages('1-3, 7')).toEqual([[1, 3], [7, 7]])
        expect(parsePages('0')).toBeNull()
        expect(parsePages('3-1')).toBeNull()
        expect(parsePages('1,,2')).toBeNull()
    })

    test('ocrmypdf redoes OCR around existing text unless forced', () => {
        expect(ocrmypdfArgs('in.pdf', 'out.pdf')).toEqual([
            '--redo-ocr',
            '--output-type',
            'pdf',
            'in.pdf',
            'out.pdf',
        ])
        expect(
            ocrmypdfArgs('in.pdf', 'out.pdf', { force: true, lang: 'eng+deu', pages: [[1, 2], [5, 5]] }),
        ).toEqual(['--force-ocr', '--output-type', 'pdf', '-l', 'eng+deu', '--pages', '1-2,5', 'in.pdf', 'out.pdf'])
    })

    test('marker strips earlier OCR text and counts pages from 0', () => {
        expect(markerArgs('in.pdf', '/o', { pages: [[1, 3], [7, 7]] })).toEqual([
            'in.pdf',
            '--output_dir',
            '/o',
            '--output_format',
            'markdown',
            '--disable_image_extraction',
            '--strip_existing_ocr',
            '--page_range',
            '0-2,6',
        ])
        expect(markerArgs('in.png', '/o', { force: true, pages: [[2, 2]] })).toEqual([
            'in.png',
            '--output_dir',
            '/o',
            '--output_format',
            'markdown',
            '--disable_image_extraction',
            '--force_ocr',
        ])
    })

    test('tidy collapses marker padding outside code fences only', () => {
        const md = 'rate  $\\eta$  the\n\n\n\n```\na  b\n```\n  - item  two'
        expect(tidyMarkdown(md)).toBe('rate $\\eta$ the\n\n```\na  b\n```\n  - item two\n')
    })

    test('tool lookup reaches homebrew and uv dirs past a minimal PATH', () => {
        const path = toolPath({ PATH: '/usr/bin', HOME: '/h' })
        expect(path.split(':')).toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin', '/h/.local/bin', '/h/.bismuth/tools/bin'])
        expect(findTool('definitely-not-a-tool-xyz', { PATH: '/usr/bin', HOME: '/h' })).toBeNull()
    })
})

async function cli(vault: string, ...args: string[]) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    const proc = Bun.spawn(
        ['bun', 'run', join(REPO_ROOT, 'cli/src/index.ts'), ...args, '--vault', vault],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { stdout, stderr, code }
}

// The fixture is a scanned page whose only real text is a margin watermark — the shape that made
// `--skip-text` skip the page and leave the body unselectable.
const canRun =
    shouldRunSlowTests(process.env) && findTool('ocrmypdf') !== null && findTool('pdftotext') !== null

describe.skipIf(!canRun)('bismuth ocr against ocrmypdf', () => {
    test(
        'a watermarked scan gets its body text layer in place, without rasterising',
        async () => {
            const vault = makeVault({ 'notes.md': '# n\n' })
            copyFileSync(FIXTURE, join(vault, 'scan.pdf'))
            const before = statSync(join(vault, 'scan.pdf')).size
            const r = await cli(vault, 'ocr', 'scan.pdf')
            expect(r.code).toBe(0)
            const out = JSON.parse(r.stdout)
            expect(out.layer.wordsBefore).toBeLessThan(6)
            expect(out.layer.wordsAfter).toBeGreaterThan(15)
            expect(out.note).toBeUndefined()
            // force-OCR would re-encode the page several times larger
            expect(statSync(join(vault, 'scan.pdf')).size).toBeLessThan(before * 2)
            expect(existsSync(join(vault, '.scan.pdf.ocr-tmp.pdf'))).toBe(false)
        },
        120_000,
    )

    test('a missing file and an escaping path refuse', async () => {
        const vault = makeVault({ 'notes.md': '# n\n' })
        const missing = await cli(vault, 'ocr', 'nope.pdf')
        expect(missing.code).toBe(1)
        expect(missing.stderr).toContain('no such file')
        const escape = await cli(vault, 'ocr', '../x.pdf')
        expect(escape.code).toBe(1)
        expect(escape.stderr).toContain('escapes vault')
    }, 30_000)
})

describe('bismuth ocr on an image', () => {
    test('refuses and names transcribe, which reads an image into its note', async () => {
        const vault = makeVault({ 'scan.png': 'x' })
        const r = await cli(vault, 'ocr', 'scan.png')
        expect(r.code).toBe(1)
        expect(r.stderr).toContain('bismuth transcribe scan.png')
    }, 30_000)
})
