// Writes pdfkit-highlights-lines.pdf: one PDFKit highlight colour per text line (40pt apart) so
// each colour shows on its own line. Usage: swift pdfkitWriteLines.swift base.pdf out.pdf
// base.pdf is a 300x300 page with five lines of text at y = 240, 200, 160, 120, 80.
import PDFKit
let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
let page = doc.page(at: 0)!
let colors: [NSColor] = [.yellow, .green, .systemBlue, .systemPink, .systemPurple]
for (i, c) in colors.enumerated() {
  let y = 240.0 - Double(i) * 40.0
  let sel = page.selection(for: CGRect(x: 40, y: y - 2, width: 200, height: 18))!
  for l in sel.selectionsByLine() {
    let b = l.bounds(for: page)
    let a = PDFAnnotation(bounds: b, forType: .highlight, withProperties: nil)
    a.markupType = .highlight
    a.color = c
    a.quadrilateralPoints = [NSValue(point: CGPoint(x: 0, y: b.height)), NSValue(point: CGPoint(x: b.width, y: b.height)), NSValue(point: CGPoint(x: 0, y: 0)), NSValue(point: CGPoint(x: b.width, y: 0))]
    page.addAnnotation(a)
  }
}
doc.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
