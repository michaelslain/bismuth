import { expect, test } from "bun:test";
import { findBareUrls } from "./urls";

test("finds a single bare URL and its offsets", () => {
  const text = "see https://example.com here";
  const spans = findBareUrls(text);
  expect(spans).toHaveLength(1);
  expect(spans[0].url).toBe("https://example.com");
  expect(text.slice(spans[0].start, spans[0].end)).toBe("https://example.com");
});

test("matches http and https, multiple per line", () => {
  const spans = findBareUrls("http://a.com and https://b.com/x?y=1");
  expect(spans.map((s) => s.url)).toEqual(["http://a.com", "https://b.com/x?y=1"]);
});

test("trims trailing sentence punctuation", () => {
  expect(findBareUrls("go to https://x.com.")[0].url).toBe("https://x.com");
  expect(findBareUrls("(https://x.com)")[0].url).toBe("https://x.com");
  expect(findBareUrls("https://x.com, then")[0].url).toBe("https://x.com");
});

test("keeps a balanced trailing paren (Wikipedia-style)", () => {
  const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
  expect(findBareUrls(`x ${url} y`)[0].url).toBe(url);
});

test("preserves query/fragment with the goo.gl shape from the report", () => {
  const url = "https://maps.app.goo.gl/hpsPtssTTrVCABED6?g_st=com.google.maps.preview.copy";
  expect(findBareUrls(`Reference: ${url}`)[0].url).toBe(url);
});

test("ignores a markdown link's destination (handled elsewhere)", () => {
  expect(findBareUrls("[text](https://example.com)")).toHaveLength(0);
});

test("no URLs → empty", () => {
  expect(findBareUrls("just some plain text, no links")).toEqual([]);
});
