// bismuth-vision: on-device text recognition for notebook pages.
//
//   bismuth-vision <file.png|jpg|heic|pdf> [--pages 1,3] [--lines] [--render <dir>]
//
// Prints one JSON array on stdout, `[{"page":1,"text":"...","confidence":0.92}]`, pages in ascending
// order. confidence is the mean over the page's lines of Vision's confidence (0..1) and is absent
// when a page has no lines. With --render <dir> nothing is recognised: each wanted page is written
// to <dir>/page-<n>.png (a PDF page at 2x) and the output is `[{"page":1,"path":"<dir>/page-1.png"}]`. An image
// is page 1. A PDF is rendered page by page with PDFKit at 2x and each render is recognised with
// VNRecognizeTextRequest (.accurate). Lines come out top to bottom, joined with newlines.
// With --lines each entry also carries `lines: [{text,x,y,w,h}]`, boxes as fractions of the page
// (0..1) with the origin at the top left. Errors go to stderr with exit 1.
import AppKit
import Foundation
import PDFKit
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func recognize(_ image: CGImage) throws -> (text: String, confidence: Double?) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted {
        // Vision's origin is bottom-left, so a larger maxY is higher on the page.
        $0.boundingBox.maxY > $1.boundingBox.maxY
    }
    let candidates = observations.compactMap { $0.topCandidates(1).first }
    let confidence = candidates.isEmpty
        ? nil
        : candidates.map { Double($0.confidence) }.reduce(0, +) / Double(candidates.count)
    return (candidates.map { $0.string }.joined(separator: "\n"), confidence)
}

func recognizeLines(_ image: CGImage) throws -> [[String: Any]] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let observations = (request.results ?? []).sorted {
        $0.boundingBox.maxY > $1.boundingBox.maxY
    }
    return observations.compactMap { o in
        guard let text = o.topCandidates(1).first?.string else { return nil }
        let b = o.boundingBox
        // Vision's origin is bottom-left; the output origin is top-left.
        return ["text": text, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]
    }
}

func entry(_ number: Int, _ image: CGImage) throws -> [String: Any] {
    let (text, confidence) = try recognize(image)
    var result: [String: Any] = ["page": number, "text": text]
    if let confidence = confidence { result["confidence"] = confidence }
    if withLines { result["lines"] = try recognizeLines(image) }
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
var withLines = false
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
