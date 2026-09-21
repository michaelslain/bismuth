// app/src/export/exporters.test.ts
import { test, expect, describe } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { renderExport, renderPreview } from './exporters'
import { defaultExportOptions } from './options'
import { THEMES } from '../themes'
import { DOC_FACES, faceCss } from './fontFaceCss'
import type { ExportDeps, ExportOptions } from './types'

// The real Lora Variable file bytes, off disk — via Bun's `with { type: 'file' }` import
// attribute (the SAME mechanism cli/src/docFontCss.ts uses for its headless build; the app's own
// docFontCss.ts instead relies on Vite's `?inline`, a browser-only transform bun test can't run,
// which is why the task 6 embedding test below builds its own docFontCss dep rather than
// importing app/src/export/docFontCss.ts directly).
import loraNormalPath from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2' with { type: 'file' }

const opts = (o: Partial<ExportOptions>): ExportOptions => ({
    ...defaultExportOptions(),
    ...o,
})

const enc = new TextDecoder()

// A base is a `type: base` md file whose view orders name + author; everything else is a
// markdown note. Export detects a base by its frontmatter (not extension), parses the file
// and runs the view (mirroring the live BaseView), so the fixture is a type:base md.
const BASE_MD =
    '---\ntype: base\nviews:\n  - type: table\n    order:\n      - file.name\n      - author\n---\n'

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
    return {
        // "Reading.md" is the base fixture; any other .md is a plain note.
        read: async (p: string) =>
            p.includes('Reading') ? BASE_MD : '# Title\n\nbody',
        resolveRows: async () => [
            {
                file: { name: 'Dune', path: 'Dune.md' } as any,
                note: { author: 'H' },
                formula: {},
            },
        ],
        htmlToPdf: async (html, _title) =>
            new TextEncoder().encode('PDF:' + html.length),
        htmlToPng: async html => ({
            bytes: new TextEncoder().encode('PNG:' + html.length),
            dataUrl: 'data:image/png;base64,AQI=',
        }),
        drawingToPng: async () => ({
            bytes: new Uint8Array([1, 2]),
            dataUrl: 'data:image/png;base64,AQI=',
        }),
        katexCss: async () => '',
        ...over,
    }
}

describe('renderExport', () => {
    test('note -> html wraps rendered markdown', async () => {
        const r = await renderExport('a/note.md', 'html', deps())
        expect(r.filename).toBe('note.html')
        expect(r.mime).toBe('text/html')
        const text = enc.decode(r.bytes)
        expect(text).toContain('<!doctype html>')
        expect(text).toContain('<h1>Title</h1>')
        expect(r.previewHtml).toBe(text)
    })

    test('note -> md returns the raw source', async () => {
        const r = await renderExport('a/note.md', 'md', deps())
        expect(r.filename).toBe('note.md')
        expect(r.mime).toBe('text/markdown')
        expect(enc.decode(r.bytes)).toBe('# Title\n\nbody')
    })

    test('note -> pdf runs htmlToPdf on the wrapped html', async () => {
        const r = await renderExport('a/note.md', 'pdf', deps())
        expect(r.filename).toBe('note.pdf')
        expect(r.mime).toBe('application/pdf')
        expect(enc.decode(r.bytes)).toStartWith('PDF:')
        expect(r.previewHtml).toContain('<h1>Title</h1>')
    })

    test('renderExport passes title "note" to htmlToPdf', async () => {
        let capturedTitle = ''
        const d = deps({
            htmlToPdf: async (html, title) => {
                capturedTitle = title
                return new TextEncoder().encode('PDF:' + html.length)
            },
        })
        await renderExport('a/note.md', 'pdf', d)
        expect(capturedTitle).toBe('note')
    })

    test('pdf export applies the chosen body font size (pt); default is 12pt', async () => {
        const def = await renderExport('a/note.md', 'pdf', deps())
        expect(def.previewHtml).toContain('font-size: 12pt')
        const big = await renderExport(
            'a/note.md',
            'pdf',
            deps(),
            'dark',
            opts({ pdfFontSize: 18 }),
        )
        expect(big.previewHtml).toContain('font-size: 18pt')
        expect(big.previewHtml).not.toContain('font-size: 12pt')
    })

    test('html/png exports do NOT force a body font size (font size is PDF-only)', async () => {
        // Narrowed to the PDF-only conditional rule (pt units) — the stylesheet legitimately
        // carries other unconditional font-size rules (.fmatter, .pagefoot) unrelated to
        // pdfFontSize, so a blanket "no font-size anywhere" assertion tests the wrong thing.
        const html = await renderExport(
            'a/note.md',
            'html',
            deps(),
            'dark',
            opts({ pdfFontSize: 18 }),
        )
        expect(html.previewHtml).not.toMatch(/font-size:\s*\d+pt/)
        const png = await renderExport(
            'a/note.md',
            'png',
            deps(),
            'dark',
            opts({ pdfFontSize: 18 }),
        )
        expect(png.previewImg).toBeDefined()
    })

    test('base -> md builds a markdown table from resolved rows', async () => {
        const r = await renderExport('Reading.md', 'md', deps())
        expect(r.filename).toBe('Reading.md')
        expect(enc.decode(r.bytes)).toContain('| name | author |')
    })

    test('base -> html builds a styled html table', async () => {
        const r = await renderExport('Reading.md', 'html', deps())
        expect(r.previewHtml).toContain('<th>name</th>')
        expect(r.previewHtml).toContain('<!doctype html>')
    })

    test('drawing -> png returns image bytes + preview img', async () => {
        const r = await renderExport('s.draw', 'png', deps())
        expect(r.filename).toBe('s.png')
        expect(r.mime).toBe('image/png')
        expect(r.previewImg).toStartWith('data:image/png')
        expect(Array.from(r.bytes)).toEqual([1, 2])
    })

    test('throws on a format not valid for the type', async () => {
        await expect(renderExport('s.draw', 'md', deps())).rejects.toThrow()
    })
})

describe('renderPreview (no downloadable bytes for text formats; PDF now runs the real print)', () => {
    test('note pdf preview calls htmlToPdf exactly once with title "note", returns previewPdf equal to the mock bytes, previewHtml/previewImg undefined', async () => {
        let pdfCalls = 0
        let capturedTitle = ''
        const mockBytes = new Uint8Array([9, 8, 7])
        const r = await renderPreview(
            'a/note.md',
            'pdf',
            deps({
                htmlToPdf: async (_html, title) => {
                    pdfCalls++
                    capturedTitle = title
                    return mockBytes
                },
            }),
        )
        expect(pdfCalls).toBe(1)
        expect(capturedTitle).toBe('note')
        expect(r.previewPdf).toEqual(mockBytes)
        expect(r.previewHtml).toBeUndefined()
        expect(r.previewImg).toBeUndefined()
    })

    test('note md preview shows the raw source in a <pre>', async () => {
        const r = await renderPreview('a/note.md', 'md', deps())
        expect(r.previewHtml).toContain('<pre>')
        expect(r.previewHtml).toContain('# Title') // escaped markdown source
    })

    test('base html preview is the rendered table', async () => {
        const r = await renderPreview('Reading.md', 'html', deps())
        expect(r.previewHtml).toContain('<th>name</th>')
    })

    test('drawing preview is an image, never a pdf', async () => {
        let pdfCalls = 0
        const r = await renderPreview(
            's.draw',
            'pdf',
            deps({
                htmlToPdf: async () => {
                    pdfCalls++
                    return new Uint8Array()
                },
            }),
        )
        expect(pdfCalls).toBe(0)
        expect(r.previewImg).toStartWith('data:image/png')
        expect(r.previewHtml).toBeUndefined()
    })

    test('theme threads through to the preview document', async () => {
        const dark = await renderPreview('a/note.md', 'html', deps(), 'dark')
        const light = await renderPreview('a/note.md', 'html', deps(), 'light')
        expect(dark.previewHtml).not.toBe(light.previewHtml) // different theme styles
        // Headless (no DOM), so both fall back to DEFAULT_PALETTE — a NAMED scope's tokens
        // straight from core/src/theme/tokens.ts (bismuth-design/ascii-extended PORTING.md §3d):
        // "light" -> the paper scope's own background, not an arbitrary hardcoded white.
        expect(light.previewHtml).toContain(THEMES.paper.background)
    })
})

// Fixtures for the export-options paths: a calendar base + a two-view base.
const CAL_MD =
    '---\ntype: base\nviews:\n  - type: calendar\n    name: Cal\n---\n'
const TWOVIEW_MD =
    '---\ntype: base\nviews:\n  - type: table\n    order:\n      - file.name\n  - type: table\n    order:\n      - author\n---\n'

function optDeps(text: string, rows: any[]): ExportDeps {
    return deps({ read: async () => text, resolveRows: async () => rows })
}

describe('export options — view selection / data vs visual / csv', () => {
    test("data mode + viewIndex selects which view's columns export", async () => {
        const d = optDeps(TWOVIEW_MD, [
            {
                file: { name: 'Dune', path: 'Dune.md' } as any,
                note: { author: 'Herbert' },
                formula: {},
            },
        ])
        const v0 = await renderExport(
            'Two.md',
            'md',
            d,
            'dark',
            opts({ viewIndex: 0 }),
        )
        const v1 = await renderExport(
            'Two.md',
            'md',
            d,
            'dark',
            opts({ viewIndex: 1 }),
        )
        expect(enc.decode(v0.bytes)).toContain('| name |')
        expect(enc.decode(v1.bytes)).toContain('| author |')
    })

    test('base -> csv builds a CSV from the resolved rows', async () => {
        const d = optDeps(BASE_MD, [
            {
                file: { name: 'Dune', path: 'Dune.md' } as any,
                note: { author: 'Herbert' },
                formula: {},
            },
        ])
        const r = await renderExport('Reading.md', 'csv', d)
        expect(r.filename).toBe('Reading.csv')
        expect(r.mime).toBe('text/csv')
        expect(enc.decode(r.bytes)).toContain('name,author')
    })

    test('csv export of a non-base file is rejected', async () => {
        await expect(renderExport('a/note.md', 'csv', deps())).rejects.toThrow(
            /only available for bases/,
        )
    })

    test('calendar base + visual mode renders the calendar grid (not a table)', async () => {
        const d = optDeps(CAL_MD, [
            {
                file: { name: '', path: '' } as any,
                note: { title: 'Dentist', date: '2026-06-10' },
                formula: {},
            },
        ])
        const r = await renderExport(
            'Cal.md',
            'html',
            d,
            'dark',
            opts({ mode: 'visual', calStart: '2026-06-15' }),
        )
        expect(r.previewHtml).toContain('exp-cal-month') // calendar grid markup
        expect(r.previewHtml).toContain('Dentist')
        expect(r.previewHtml).toContain('.exp-cal-cell') // injected calendar CSS
        expect(r.previewHtml).not.toContain('<th>') // NOT the flat table
    })

    test('calendar base + data mode still exports the flat table', async () => {
        const d = optDeps(CAL_MD, [
            {
                file: { name: '', path: '' } as any,
                note: { title: 'Dentist', date: '2026-06-10' },
                formula: {},
            },
        ])
        const r = await renderExport(
            'Cal.md',
            'html',
            d,
            'dark',
            opts({ mode: 'data' }),
        )
        expect(r.previewHtml).toContain('<th>') // flat table
        expect(r.previewHtml).not.toContain('exp-cal-month')
    })
})

describe('include/exclude frontmatter', () => {
    const FM_NOTE = '---\ntitle: Foo\ntags: [a]\n---\n# Title\n\nbody text'
    const withFm = (over: Partial<ExportDeps> = {}) =>
        deps({ read: async () => FM_NOTE, ...over })

    test('md export includes frontmatter by default (unchanged historical behavior)', async () => {
        const r = await renderExport('note.md', 'md', withFm())
        expect(enc.decode(r.bytes)).toBe(FM_NOTE)
    })

    test('md export strips frontmatter when includeFrontmatter is false', async () => {
        const r = await renderExport(
            'note.md',
            'md',
            withFm(),
            'dark',
            opts({ includeFrontmatter: false }),
        )
        const text = enc.decode(r.bytes)
        expect(text).toBe('# Title\n\nbody text')
        expect(text).not.toContain('title: Foo')
    })

    test('html export renders frontmatter as its own styled block (single-doc path)', async () => {
        // The single continuous-document path (bodyHtml) renders frontmatter as a distinct
        // .fmatter block (bismuth-design/ascii-extended PORTING.md §3d) rather than letting the raw
        // `---\nkey: val\n---` fence flow through the markdown renderer as mangled prose —
        // unlike the page-break-split path below, which still re-prepends it as raw prose
        // (a marker-delimited section has no single "page 1" HTML doc of its own to hook).
        const r = await renderExport('note.md', 'html', withFm())
        expect(r.previewHtml).toContain('class="fmatter"')
        expect(r.previewHtml).toContain('<span class="fm-k">title:</span> Foo')
        expect(r.previewHtml).toContain('<h1>Title</h1>')
    })

    test('html export excludes frontmatter from the rendered body when off', async () => {
        const r = await renderExport(
            'note.md',
            'html',
            withFm(),
            'dark',
            opts({ includeFrontmatter: false }),
        )
        expect(r.previewHtml).not.toContain('class="fmatter"')
        expect(r.previewHtml).not.toContain('title: Foo')
        expect(r.previewHtml).toContain('<h1>Title</h1>')
    })

    test('a note with no frontmatter is unaffected by the toggle either way', async () => {
        const on = await renderExport(
            'a/note.md',
            'md',
            deps(),
            'dark',
            opts({ includeFrontmatter: true }),
        )
        const off = await renderExport(
            'a/note.md',
            'md',
            deps(),
            'dark',
            opts({ includeFrontmatter: false }),
        )
        expect(enc.decode(on.bytes)).toBe(enc.decode(off.bytes))
    })

    test("a base file's frontmatter (config, not content) never appears regardless of the toggle", async () => {
        const r = await renderExport(
            'Reading.md',
            'md',
            deps(),
            'dark',
            opts({ includeFrontmatter: false }),
        )
        expect(enc.decode(r.bytes)).toContain('| name | author |')
    })
})

describe('markdown-syntax markers (showMarkdownSyntax)', () => {
    const H2_NOTE = '# Title\n\n## Section\n\nbody'
    const withH2 = (over: Partial<ExportDeps> = {}) =>
        deps({ read: async () => H2_NOTE, ...over })

    test('html export hides markdown-syntax markers by default', async () => {
        const r = await renderExport('note.md', 'html', withH2())
        expect(r.previewHtml).not.toContain('content: "## "')
    })

    test('html export shows markdown-syntax markers when the option is on', async () => {
        const r = await renderExport(
            'note.md',
            'html',
            withH2(),
            'dark',
            opts({ showMarkdownSyntax: true }),
        )
        expect(r.previewHtml).toContain('content: "## "')
        expect(r.previewHtml).toContain('content: "###### "')
    })

    test('png export threads the option through the wrapBody path too', async () => {
        let capturedHtml = ''
        const d = withH2({
            htmlToPng: async html => {
                capturedHtml = html
                return { bytes: new Uint8Array(), dataUrl: '' }
            },
        })
        await renderExport(
            'note.md',
            'png',
            d,
            'dark',
            opts({ showMarkdownSyntax: true }),
        )
        expect(capturedHtml).toContain('content: "## "')
    })

    test('md preview (raw source dump) never grows markdown-syntax css, regardless of the option', async () => {
        // renderPreview's md format wraps the raw text in a <pre> via a direct wrapHtmlDocument
        // call that never receives ExportOptions — this guards against a future wiring mistake
        // that threads opts into that call site by mistake.
        const r = await renderPreview(
            'note.md',
            'md',
            withH2(),
            'dark',
            opts({ showMarkdownSyntax: true }),
        )
        expect(r.previewHtml).not.toContain('content: "## "')
    })

    test('drawing pdf export never grows markdown-syntax css, regardless of the option', async () => {
        // Same reasoning: the drawing pdf path wraps a bare <img>, via a direct wrapHtmlDocument
        // call with no ExportOptions in scope.
        let capturedHtml = ''
        const d = deps({
            htmlToPdf: async html => {
                capturedHtml = html
                return new Uint8Array()
            },
        })
        await renderExport(
            's.draw',
            'pdf',
            d,
            'dark',
            opts({ showMarkdownSyntax: true }),
        )
        expect(capturedHtml).not.toContain('content: "## "')
    })
})

describe('PNG export split by page-break markers', () => {
    const MARK = '<!-- pagebreak -->'

    test('no markers -> a single png, filename unchanged', async () => {
        const r = await renderExport('note.md', 'png', deps())
        expect(r.filename).toBe('note.png')
        expect(r.files).toBeUndefined()
    })

    test('one marker -> two numbered png files; the single-result fields mirror page 1', async () => {
        const d = deps({ read: async () => `Page one\n${MARK}\nPage two` })
        const r = await renderExport('note.md', 'png', d)
        expect(r.files?.map(f => f.filename)).toEqual([
            'note-1.png',
            'note-2.png',
        ])
        expect(r.filename).toBe('note-1.png')
        expect(r.previewImg).toStartWith('data:image/png')
    })

    test('many markers -> that many files, each rasterized independently', async () => {
        let calls = 0
        const d = deps({
            read: async () => `one\n${MARK}\ntwo\n${MARK}\nthree`,
            htmlToPng: async html => {
                calls++
                return {
                    bytes: new TextEncoder().encode('PNG:' + html.length),
                    dataUrl: 'data:image/png;base64,AQI=',
                }
            },
        })
        const r = await renderExport('note.md', 'png', d)
        expect(calls).toBe(3)
        expect(r.files?.map(f => f.filename)).toEqual([
            'note-1.png',
            'note-2.png',
            'note-3.png',
        ])
    })

    test('frontmatter never becomes its own page, even with includeFrontmatter: true', async () => {
        const d = deps({
            read: async () =>
                `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two`,
        })
        const r = await renderExport(
            'note.md',
            'png',
            d,
            'dark',
            opts({ includeFrontmatter: true }),
        )
        expect(r.files).toHaveLength(2) // not 3 — the frontmatter never counts as a page
    })

    test("includeFrontmatter: true puts the frontmatter (as prose) on page 1's rendered doc; false omits it", async () => {
        const rendered: string[] = []
        const d = deps({
            read: async () =>
                `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two`,
            htmlToPng: async html => {
                rendered.push(html)
                return {
                    bytes: new Uint8Array([1]),
                    dataUrl: 'data:image/png;base64,AQI=',
                }
            },
        })
        await renderExport(
            'note.md',
            'png',
            d,
            'dark',
            opts({ includeFrontmatter: true }),
        )
        expect(rendered[0]).toContain('title: Foo') // page 1 carries the fm as prose
        expect(rendered[1]).not.toContain('title: Foo')
        rendered.length = 0
        await renderExport(
            'note.md',
            'png',
            d,
            'dark',
            opts({ includeFrontmatter: false }),
        )
        expect(rendered[0]).not.toContain('title: Foo')
    })

    test("a base file's rendered table is never split into pages", async () => {
        const d = deps({ read: async () => BASE_MD })
        const r = await renderExport('Reading.md', 'png', d)
        expect(r.files).toBeUndefined()
        expect(r.filename).toBe('Reading.png')
    })

    test('PDF export of a page-break note is a single result — page slicing happens at the canvas level in htmlToPdf.ts, not here', async () => {
        const d = deps({ read: async () => `Page one\n${MARK}\nPage two` })
        const r = await renderExport('note.md', 'pdf', d)
        expect(r.files).toBeUndefined()
        expect(r.filename).toBe('note.pdf')
    })
})

describe('preview shows page separation (sheet per section)', () => {
    const MARK = '<!-- pagebreak -->'
    const PAGED = `Page one body\n${MARK}\nPage two body\n${MARK}\nPage three body`

    // png/html preview a marker-split note as one bordered "sheet" per section. (PDF instead
    // shows the ACTUAL paginated Letter pages — see the pdf-specific test below — because it
    // auto-paginates by height, not just at markers.)
    for (const fmt of ['png', 'html'] as const) {
        test(`${fmt} preview of a page-broken note renders one labeled sheet per section`, async () => {
            const r = await renderPreview(
                'note.md',
                fmt,
                deps({ read: async () => PAGED }),
            )
            const html = r.previewHtml!
            expect(html.match(/class="bismuth-preview-page"/g)).toHaveLength(3)
            expect(html).toContain('Page 1 of 3')
            expect(html).toContain('Page 3 of 3')
            expect(html).toContain('Page two body')
            expect(html).toContain('.bismuth-preview-page') // the sheet CSS is inlined
        })
    }

    test('pdf preview of a page-broken note shows the real bytes (previewPdf), NOT the sheet-per-section wrappers', async () => {
        const r = await renderPreview(
            'note.md',
            'pdf',
            deps({ read: async () => PAGED }),
        )
        expect(r.previewPdf).toBeDefined()
        expect(r.previewHtml).toBeUndefined()
    })

    test('a note with no page breaks previews WITHOUT sheet wrappers (unchanged)', async () => {
        const r = await renderPreview('a/note.md', 'png', deps())
        expect(r.previewHtml).not.toContain('bismuth-preview-page')
    })

    test("preview sections mirror the export's frontmatter handling (fm on sheet 1 when included, absent when excluded)", async () => {
        const d = deps({
            read: async () =>
                `---\ntitle: Foo\n---\nPage one\n${MARK}\nPage two`,
        })
        const on = await renderPreview(
            'note.md',
            'png',
            d,
            'dark',
            opts({ includeFrontmatter: true }),
        )
        expect(
            on.previewHtml!.match(/class="bismuth-preview-page"/g),
        ).toHaveLength(2) // fm is not a page
        expect(on.previewHtml).toContain('title: Foo')
        const off = await renderPreview(
            'note.md',
            'png',
            d,
            'dark',
            opts({ includeFrontmatter: false }),
        )
        expect(off.previewHtml).not.toContain('title: Foo')
    })

    test('a base preview never gets sheet wrappers', async () => {
        const r = await renderPreview('Reading.md', 'html', deps())
        expect(r.previewHtml).not.toContain('bismuth-preview-page')
    })
})

// Task 6: the export pipeline embeds Lora Variable (replacing the earlier static serif). docFontCss.ts's own
// header comment records the exact shape of the bug this guards against — the export NAMED a
// prose family in its font stack but shipped no file for it, so every export silently fell
// through the stack to Georgia. A test that only checks the `@font-face` STRING is present would
// have passed on that broken build too (the string was always there; only the bytes were
// missing) — this is exactly the mistake this plan already made once with `document.fonts.check`,
// which reports true for a family that resolved to nothing. So this proves resolution the only
// way that can't be faked headlessly: register the bytes the export actually embedded with a real
// font engine and MEASURE a rendered string through the export's own font-family stack, comparing
// it against the same string through Georgia alone.
//
// The font engine is @napi-rs/canvas (core/src/drawing/export.ts already rasterises ink with it),
// but it is a dependency of the `core` workspace, not `app` — and app's own bun test cannot
// resolve an undeclared package (confirmed directly: importing it at the top of this file makes
// bun test fail the whole file with "Cannot find module"). Rather than add it to
// app/package.json (outside this task's file list, and node_modules here is a symlink this task
// was told not to `bun install`), the measurement runs in a short-lived subprocess whose script
// lives OUTSIDE every workspace (a tmp file) — the one place Bun's resolver reaches the
// already-installed package without a workspace declaration.
describe('the embedded Lora Variable face actually resolves (task 6)', () => {
    test('a prose run measures a different width through the real embedded face than through Georgia alone', async () => {
        const loraFace = DOC_FACES.find(
            f => f.family === 'Lora Variable' && f.style === 'normal',
        )
        expect(loraFace).toBeDefined()

        // Build the SAME kind of docFontCss the headless (cli) export path builds for real —
        // real file bytes off disk, base64-inlined via the shared faceCss() — since the app's own
        // docFontCss.ts relies on Vite's `?inline`, which is a browser-only transform bun test
        // cannot exercise (confirmed: under plain `bun test` that import resolves to a bare cache
        // file PATH string, not inlined base64, so calling it directly here would silently embed
        // garbage and pass anyway).
        const bytes = await Bun.file(loraNormalPath).arrayBuffer()
        const src = `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`
        const docFontCss = async () => faceCss([{ ...loraFace!, src }])

        const r = await renderExport('a/note.md', 'html', deps({ docFontCss }))
        const html = enc.decode(r.bytes)

        // Acceptance: a real @font-face block for Lora Variable carrying a data: URI, and the
        // prose stack naming it FIRST (a browser only ever reaches Georgia if this entry misses).
        expect(html).toContain("@font-face{font-family:'Lora Variable'")
        expect(html).toMatch(/src:url\(data:font\/woff2;base64,/)
        expect(html).toContain("'Lora Variable', Lora, Georgia, serif")

        // Pull the bytes back out of the RENDERED document (not the ones handed in above) so the
        // measurement proves the whole pipeline, not just the fixture.
        const m =
            /@font-face\{font-family:'Lora Variable';font-style:normal;font-weight:[^;]+;font-display:swap;src:url\((data:font\/woff2;base64,[^)]+)\)/.exec(
                html,
            )
        expect(m).not.toBeNull()
        const embeddedDataUri = m![1]!
        const embeddedBytes = Buffer.from(
            embeddedDataUri.split(',')[1]!,
            'base64',
        )
        expect(embeddedBytes.length).toBeGreaterThan(1000) // a real font file, not a stub

        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const fontFile = join(tmpdir(), `task6-lora-${stamp}.woff2`)
        const scriptFile = join(tmpdir(), `task6-measure-${stamp}.ts`)
        await Bun.write(fontFile, embeddedBytes)
        // The full stack, exactly as the export names it, so the fallback semantics (does the
        // renderer actually try the NEXT entry when the first is unregistered?) are exercised the
        // same way a real browser's font matching would, not just a bare family name in
        // isolation. Registers under the SAME family name the export declares, then measures
        // once before and once after — before registering, 'Lora Variable' genuinely doesn't
        // exist, so the stack must fall through to Georgia and measure IDENTICALLY to it. That is
        // the original bug's exact shape, reproduced on purpose as a sanity check the real
        // assertion depends on.
        await Bun.write(
            scriptFile,
            `import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
const PANGRAM = 'The quick brown fox jumps over the lazy dog 0123456789'
const stack = "16px 'Lora Variable', Lora, Georgia, serif"
const canvas = createCanvas(10, 10)
const ctx = canvas.getContext('2d')
ctx.font = stack
const beforeRegistering = ctx.measureText(PANGRAM).width
ctx.font = '16px Georgia'
const georgiaWidth = ctx.measureText(PANGRAM).width
const bytes = await Bun.file(process.argv[2]).arrayBuffer()
const key = GlobalFonts.register(Buffer.from(bytes), 'Lora Variable')
ctx.font = stack
const loraWidth = ctx.measureText(PANGRAM).width
console.log(JSON.stringify({ beforeRegistering, georgiaWidth, loraWidth, registered: key !== null }))
`,
        )
        try {
            const proc = Bun.spawn(
                [process.execPath, 'run', scriptFile, fontFile],
                { stdout: 'pipe', stderr: 'pipe' },
            )
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ])
            if (exitCode !== 0) {
                throw new Error(
                    `font measurement subprocess exited ${exitCode}: ${stderr}`,
                )
            }
            const result = JSON.parse(stdout) as {
                beforeRegistering: number
                georgiaWidth: number
                loraWidth: number
                registered: boolean
            }

            expect(result.registered).toBe(true)
            // Sanity: unregistered, the export's own stack collapses onto Georgia exactly — the
            // original bug's shape. If this ever failed, the proof below would be meaningless.
            expect(result.beforeRegistering).toBe(result.georgiaWidth)
            // The proof: registering the REAL bytes this export embeds changes the measured
            // width of the export's own font stack, and it no longer collapses onto Georgia's.
            expect(result.loraWidth).toBeGreaterThan(0)
            expect(result.loraWidth).not.toBe(result.georgiaWidth)
        } finally {
            await Promise.all([
                unlink(fontFile).catch(() => {}),
                unlink(scriptFile).catch(() => {}),
            ])
        }
    })
})
