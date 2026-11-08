// app/src/preview/_articlePdf.ts
// Story fixture: a one-page article PDF with a colour photo and a line chart on white, both
// embedded as raster images, for the dark-mode stories (PDF viewer and book reader).
import { jsPDF } from 'jspdf'

/** Where the article's photo and chart sit on its US-Letter page (612 x 792 pt), in points. */
export const ARTICLE_PHOTO = { x: 72, y: 170, w: 300, h: 188 }
export const ARTICLE_CHART = { x: 72, y: 400, w: 300, h: 163 }

/** An article page: a heading, body text, a colour photo and a line chart on white. */
export function buildArticlePdf(): ArrayBuffer {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    pdf.setFontSize(22)
    pdf.text('Rivers of the valley', 72, 90)
    pdf.setFontSize(11)
    const body =
        'The valley floor floods each spring, and the towns along it have learned to build on stilts. ' +
        'The photograph below was taken at dusk from the eastern ridge; the chart beside the text ' +
        'shows the water level over one year, measured at the old mill.'
    pdf.text(pdf.splitTextToSize(body, 468), 72, 120)
    // the photo: a dusk landscape, drawn into a canvas and embedded as a raster image
    const photo = document.createElement('canvas')
    photo.width = 480
    photo.height = 300
    const g = photo.getContext('2d')!
    const sky = g.createLinearGradient(0, 0, 0, 200)
    sky.addColorStop(0, '#1d2b64')
    sky.addColorStop(1, '#f8a35b')
    g.fillStyle = sky
    g.fillRect(0, 0, 480, 300)
    g.fillStyle = '#f9e27a'
    g.beginPath()
    g.arc(340, 170, 26, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#2f3e2a'
    g.beginPath()
    g.moveTo(0, 210)
    g.quadraticCurveTo(140, 140, 260, 205)
    g.quadraticCurveTo(380, 150, 480, 200)
    g.lineTo(480, 300)
    g.lineTo(0, 300)
    g.fill()
    g.fillStyle = '#1b2a40'
    g.fillRect(0, 250, 480, 50)
    pdf.addImage(photo, 'PNG', ARTICLE_PHOTO.x, ARTICLE_PHOTO.y, ARTICLE_PHOTO.w, ARTICLE_PHOTO.h)
    pdf.text('The valley at dusk, from the eastern ridge.', 72, 374)
    // the chart: marks on white paper, embedded as a raster image too
    const chart = document.createElement('canvas')
    chart.width = 480
    chart.height = 260
    const c = chart.getContext('2d')!
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, 480, 260)
    c.strokeStyle = '#dddddd'
    for (let y = 40; y < 230; y += 40) {
        c.beginPath()
        c.moveTo(40, y)
        c.lineTo(460, y)
        c.stroke()
    }
    c.strokeStyle = '#000000'
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(40, 20)
    c.lineTo(40, 230)
    c.lineTo(460, 230)
    c.stroke()
    c.strokeStyle = '#d6402b'
    c.lineWidth = 3
    c.beginPath()
    ;[200, 170, 90, 60, 110, 160, 190, 200, 185, 150, 120, 140].forEach((v, i) =>
        i === 0 ? c.moveTo(40 + i * 38, v) : c.lineTo(40 + i * 38, v),
    )
    c.stroke()
    pdf.addImage(chart, 'PNG', ARTICLE_CHART.x, ARTICLE_CHART.y, ARTICLE_CHART.w, ARTICLE_CHART.h)
    pdf.text('Water level at the old mill, one year.', 72, 580)
    return pdf.output('arraybuffer')
}
