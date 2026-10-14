import PDFKit
let doc = PDFDocument(url: URL(fileURLWithPath: "out.pdf"))!
let page = doc.page(at: 0)!
let sel = page.selection(for: CGRect(x: 50, y: 195, width: 120, height: 25))!
print("selected:", sel.string ?? "nil")
let lines = sel.selectionsByLine()
for (i,c) in [NSColor.yellow, NSColor.green, NSColor.systemBlue, NSColor.systemPink, NSColor.systemPurple].enumerated() {
  for l in lines {
    let b = l.bounds(for: page)
    let a = PDFAnnotation(bounds: b, forType: .highlight, withProperties: nil)
    a.markupType = .highlight
    a.color = c
    a.quadrilateralPoints = [NSValue(point: CGPoint(x:0,y:b.height)), NSValue(point: CGPoint(x:b.width,y:b.height)), NSValue(point: CGPoint(x:0,y:0)), NSValue(point: CGPoint(x:b.width,y:0))]
    page.addAnnotation(a)
  }
}
doc.write(to: URL(fileURLWithPath: "pk_out.pdf"))
