import { test, expect, describe } from "bun:test";
import {
  kindForTarget,
  parseSize,
  altSize,
  specForWikiEmbed,
  specForMarkdownImage,
  computeSizeEdit,
} from "./embedSpec";

// A stand-in for api.assetUrl so these pure helpers stay DOM/network-free.
const asset = (t: string) => `/asset?path=${encodeURIComponent(t)}`;

describe("kindForTarget", () => {
  test("classifies media by extension (case-insensitive)", () => {
    expect(kindForTarget("a.png")).toBe("image");
    expect(kindForTarget("a.JPG")).toBe("image");
    expect(kindForTarget("a.webp")).toBe("image");
    expect(kindForTarget("doc.pdf")).toBe("pdf");
    expect(kindForTarget("clip.mp4")).toBe("video");
    expect(kindForTarget("song.mp3")).toBe("audio");
  });
  test("bare names and unknown extensions are notes", () => {
    expect(kindForTarget("Another Note")).toBe("note");
    expect(kindForTarget("thing.xyz")).toBe("note");
  });
  test(".draw is not embeddable", () => {
    expect(kindForTarget("Sketch.draw")).toBeNull();
  });
});

describe("parseSize", () => {
  test("width-only and WxH", () => {
    expect(parseSize("300")).toEqual({ width: 300 });
    expect(parseSize("300x200")).toEqual({ width: 300, height: 200 });
  });
  test("missing / non-numeric alias yields no size", () => {
    expect(parseSize(undefined)).toEqual({});
    expect(parseSize("caption")).toEqual({});
  });
});

describe("altSize", () => {
  test("splits a trailing |WIDTH off the alt", () => {
    expect(altSize("logo|300")).toEqual({ alt: "logo", width: 300 });
    expect(altSize("logo")).toEqual({ alt: "logo" });
    expect(altSize("a|b|120")).toEqual({ alt: "a|b", width: 120 });
  });
  test("a non-numeric pipe suffix is kept as alt text", () => {
    expect(altSize("cats|dogs")).toEqual({ alt: "cats|dogs" });
  });
});

describe("specForWikiEmbed", () => {
  test("image embed carries src + alt + parsed size", () => {
    expect(specForWikiEmbed("testimg.png|140", asset)).toEqual({
      kind: "image", src: asset("testimg.png"), alt: "testimg.png", width: 140,
    });
  });
  test("sizeless image embed has no width", () => {
    const s = specForWikiEmbed("photo.jpg", asset);
    expect(s?.kind).toBe("image");
    expect(s?.width).toBeUndefined();
  });
  test("pdf embed keeps the heading fragment as its page", () => {
    expect(specForWikiEmbed("doc.pdf#page=3", asset)).toMatchObject({ kind: "pdf", page: "page=3" });
  });
  test("bare target is a note; .draw is dropped", () => {
    expect(specForWikiEmbed("Some Note", asset)).toEqual({ kind: "note", target: "Some Note" });
    expect(specForWikiEmbed("Sketch.draw", asset)).toBeNull();
  });
});

describe("specForMarkdownImage", () => {
  test("remote/data URLs render as-is with alt-carried width", () => {
    expect(specForMarkdownImage("https://x/y.png", "cap|80", asset)).toEqual({
      kind: "image", src: "https://x/y.png", alt: "cap", width: 80,
    });
    expect(specForMarkdownImage("data:image/png;base64,AAAA", "", asset)?.src)
      .toBe("data:image/png;base64,AAAA");
  });
  test("a bare vault path is classified by extension", () => {
    expect(specForMarkdownImage("attachments/testimg.png", "", asset)).toMatchObject({
      kind: "image", src: asset("attachments/testimg.png"),
    });
    expect(specForMarkdownImage("clip.mp4", "", asset)?.kind).toBe("video");
    expect(specForMarkdownImage("doc.pdf#page=2", "", asset)).toMatchObject({ kind: "pdf", page: "page=2" });
  });
  test(".draw markdown embed is dropped", () => {
    expect(specForMarkdownImage("Sketch.draw", "", asset)).toBeNull();
  });
});

describe("computeSizeEdit", () => {
  test("adds a size to a bare wiki embed", () => {
    const line = "![[testimg.png]]";
    const edit = computeSizeEdit(line, 0, 5, "140");
    expect(edit).toEqual({ from: 0, to: line.length, insert: "![[testimg.png|140]]" });
  });
  test("replaces an existing wiki size (keeps target + #frag)", () => {
    const line = "![[doc.pdf#page=2|300]]";
    const edit = computeSizeEdit(line, 0, 4, "220x140");
    expect(edit?.insert).toBe("![[doc.pdf#page=2|220x140]]");
  });
  test("picks the wiki embed under the caret when a line has two", () => {
    const line = "![[a.png]] ![[b.png]]";
    const posInB = line.indexOf("![[b.png]]") + 2;
    expect(computeSizeEdit(line, 0, posInB, "50")?.insert).toBe("![[b.png|50]]");
  });
  test("markdown image persists width in the alt; WxH collapses to width", () => {
    const line = "![logo](attachments/testimg.png)";
    expect(computeSizeEdit(line, 0, 2, "90x60")?.insert).toBe("![logo|90](attachments/testimg.png)");
  });
  test("markdown image drops a stale numeric alt-width before re-appending", () => {
    const line = "![logo|300](x.png)";
    expect(computeSizeEdit(line, 0, 2, "120")?.insert).toBe("![logo|120](x.png)");
  });
  test("offsets honor lineFrom for a non-zero line start", () => {
    const line = "![[a.png]]";
    const edit = computeSizeEdit(line, 100, 103, "60");
    expect(edit).toEqual({ from: 100, to: 110, insert: "![[a.png|60]]" });
  });
  test("returns null when the line has no embed", () => {
    expect(computeSizeEdit("just some text", 0, 3, "100")).toBeNull();
  });
});
