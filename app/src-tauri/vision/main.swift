// bismuth-vision: on-device text recognition for notebook pages.
//
//   bismuth-vision <file.png|jpg|heic|pdf> [--pages 1,3] [--lines] [--render <dir>]
//
// Prints one JSON array on stdout, `[{"page":1,"text":"...","confidence":0.92,"lines":[...]}]`, pages in ascending
// order. confidence is the mean over the page's lines of Vision's confidence (0..1) and is absent
// when a page has no lines. With --render <dir> nothing is recognised: each wanted page is written
// to <dir>/page-<n>.png (a PDF page at 2x) and the output is `[{"page":1,"path":"<dir>/page-1.png"}]`. An image
// is page 1. A PDF is rendered page by page with PDFKit at 2x and each render is recognised with
// VNRecognizeTextRequest (.accurate). Lines come out top to bottom, joined with newlines.
// Each entry also carries `lines: [{text,confidence,misspelled,x,y,w,h}]`, one per recognised line in the
// same order as the text, boxes as fractions of the page (0..1) with the origin at the top left.
// `--lines` is accepted and changes nothing. Errors go to stderr with exit 1.
import AppKit
import Foundation
import PDFKit
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

/// The system spell checker's count of misspelled words in a line: a recognised line with a word no
/// dictionary knows is likely misread (the rule in core/src/transcriptChecks.ts is fit on it).
let speller: NSSpellChecker = {
    let c = NSSpellChecker.shared
    c.automaticallyIdentifiesLanguages = false
    _ = c.setLanguage("en")
    return c
}()

func misspelled(_ line: String) -> Int {
    let length = (line as NSString).length
    var count = 0
    var start = 0
    while start < length {
        let r = speller.checkSpelling(of: line, startingAt: start)
        if r.location == NSNotFound || r.location < start { break }
        count += 1
        start = r.location + r.length
    }
    return count
}

/// One recognition pass: the page text (lines top to bottom, joined with newlines), the mean line
/// confidence, and each line with its own confidence, misspelled-word count and box (fractions, top-left origin).
func recognize(_ image: CGImage) throws -> (text: String, confidence: Double?, lines: [[String: Any]]) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted {
        // Vision's origin is bottom-left, so a larger maxY is higher on the page.
        $0.boundingBox.maxY > $1.boundingBox.maxY
    }
    var texts: [String] = []
    var confidences: [Double] = []
    var lines: [[String: Any]] = []
    for o in observations {
        guard let top = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        texts.append(top.string)
        confidences.append(Double(top.confidence))
        lines.append([
            "text": top.string, "confidence": Double(top.confidence), "misspelled": misspelled(top.string),
            "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height,
        ])
    }
    let confidence = confidences.isEmpty ? nil : confidences.reduce(0, +) / Double(confidences.count)
    return (texts.joined(separator: "\n"), confidence, lines)
}

func entry(_ number: Int, _ image: CGImage) throws -> [String: Any] {
    let (text, confidence, lines) = try recognize(image)
    var result: [String: Any] = ["page": number, "text": text, "lines": lines]
    if let confidence = confidence { result["confidence"] = confidence }
    return result
}

/// Shrinks an image so its long edge is at most maxEdge px.
func capped(_ image: CGImage, _ maxEdge: Int = 2048) -> CGImage {
    let long = max(image.width, image.height)
    guard long > maxEdge else { return image }
    let s = Double(maxEdge) / Double(long)
    let w = Int(Double(image.width) * s), h = Int(Double(image.height) * s)
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? image
}

func writePNG(_ image: CGImage, _ number: Int) -> [String: Any] {
    guard let dir = renderDir else { fail("no render dir") }
    let target = URL(fileURLWithPath: dir).appendingPathComponent("page-\(number).png")
    guard let data = NSBitmapImageRep(cgImage: capped(image)).representation(using: .png, properties: [:]),
          (try? data.write(to: target)) != nil else { fail("cannot write \(target.path)") }
    return ["page": number, "path": target.path]
}

/// One output entry per page: recognised text, or (--render) the written image.
func handle(_ number: Int, _ image: CGImage) throws -> [String: Any] {
    renderDir == nil ? try entry(number, image) : writePNG(image, number)
}

func render(_ page: PDFPage) -> CGImage? {
    let box = page.bounds(for: .mediaBox)
    let size = NSSize(width: box.width * 2, height: box.height * 2)
    let image = page.thumbnail(of: size, for: .mediaBox)
    var rect = CGRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

var path: String?
var wanted: Set<Int>?
var withLines = false  // accepted for older callers; lines are always included
var renderDir: String?
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let arg = args.removeFirst()
    if arg == "--pages" {
        guard !args.isEmpty else { fail("--pages needs a list like 1,3") }
        let list = args.removeFirst().split(separator: ",").compactMap { Int($0) }
        wanted = Set(list)
    } else if arg == "--render" {
        guard !args.isEmpty else { fail("--render needs a directory") }
        renderDir = args.removeFirst()
    } else if arg == "--lines" {
        withLines = true
    } else if path == nil {
        path = arg
    } else {
        fail("unexpected argument: \(arg)")
    }
}
guard let file = path else { fail("usage: bismuth-vision <file> [--pages 1,3] [--lines] [--render <dir>]") }
let url = URL(fileURLWithPath: file)
guard FileManager.default.fileExists(atPath: file) else { fail("not found: \(file)") }

if let dir = renderDir {
    do { try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true) } catch {
        fail("cannot create \(dir)")
    }
}
var out: [[String: Any]] = []
do {
    if url.pathExtension.lowercased() == "pdf" {
        guard let doc = PDFDocument(url: url) else { fail("cannot open pdf: \(file)") }
        if doc.isLocked { fail("pdf is password-protected: \(file)") }
        for index in 0..<doc.pageCount {
            let number = index + 1
            if let wanted = wanted, !wanted.contains(number) { continue }
            guard let page = doc.page(at: index), let image = render(page) else {
                fail("cannot render page \(number)")
            }
            out.append(try handle(number, image))
        }
    } else {
        guard let image = NSImage(contentsOf: url) else { fail("cannot read image: \(file)") }
        var rect = CGRect(origin: .zero, size: image.size)
        guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            fail("cannot decode image: \(file)")
        }
        if wanted == nil || wanted!.contains(1) {
            out.append(try handle(1, cg))
        }
    }
    let data = try JSONSerialization.data(withJSONObject: out, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("recognition failed: \(error.localizedDescription)")
}
