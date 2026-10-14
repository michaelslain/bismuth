import PDFKit
for n in CommandLine.arguments.dropFirst() {
  let doc = PDFDocument(url: URL(fileURLWithPath: n))!
  let page = doc.page(at: 0)!
  let img = page.thumbnail(of: CGSize(width: 600, height: 600), for: .mediaBox)
  let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
  // PDF (110,207) -> pixel (220, 600-414=186) ; sample empty highlight area near x=300 (150pt) right end: PDF(165,203)
  func px(_ x: Double,_ y: Double)->String { let c = rep.colorAt(x: Int(x*2), y: Int(600-y*2))!.usingColorSpace(.sRGB)!; return String(format:"%.2f,%.2f,%.2f", c.redComponent,c.greenComponent,c.blueComponent) }
  print(n, "inQuad(165,210):", px(165,210), "outside(165,250):", px(165,250))
}
