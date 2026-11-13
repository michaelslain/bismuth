// core/test/pdfMergeCompiled.test.ts — a merge draws pages inside a `bun build --compile` binary, as it
// does in the installed app's core. A scanned page is an image, and pdf.js draws an image through a
// scratch canvas its own Node factory `require`s at runtime, which a compiled binary cannot resolve;
// `PdfjsCanvasFactory` replaces that factory.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { tempDir } from './helpers'

/** A pdf of `n` pages, each one photo-like image the way a scanner exports a notebook page. */
async function scannedPdf(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    for (let p = 0; p < n; p++) {
        const c = createCanvas(120, 160)
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#eee'
        ctx.fillRect(0, 0, 120, 160)
        ctx.fillStyle = '#222'
        for (let k = 0; k < 6; k++) ctx.fillRect(10, 20 + k * 20 + p * 3, 60 + k * 7, 4)
        const png = await doc.embedPng(c.toBuffer('image/png'))
        doc.addPage([300, 400]).drawImage(png, { x: 0, y: 0, width: 300, height: 400 })
    }
    return doc.save()
}

test('a compiled binary draws the ink of every scanned page', async () => {
    const dir = tempDir('bismuth-pdfmerge-compiled-')
    const pdf = join(dir, 'scan.pdf')
    writeFileSync(pdf, await scannedPdf(3))
    const entry = join(import.meta.dir, '..', 'src', 'pdfMerge.ts')
    const main = join(dir, 'main.ts')
    writeFileSync(
        main,
        `import { pageInk } from ${JSON.stringify(entry)}\n` +
            `const ink = await pageInk(new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer()))\n` +
            `console.log(JSON.stringify(ink.map(m => m.reduce((a, b) => a + b, 0))))\n`,
    )
    const bin = join(dir, 'probe')
    const build = spawnSync('bun', ['build', '--compile', main, '--outfile', bin], { cwd: join(import.meta.dir, '..'), encoding: 'utf8' })
    expect(build.status, build.stderr).toBe(0)
    const run = spawnSync(bin, [pdf], { encoding: 'utf8', timeout: 60_000 })
    expect(run.status, run.stderr).toBe(0)
    const sums = JSON.parse(run.stdout.trim()) as number[]
    expect(sums).toHaveLength(3)
    for (const s of sums) expect(s).toBeGreaterThan(0)
}, 120_000)
