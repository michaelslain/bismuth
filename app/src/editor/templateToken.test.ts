import { describe, expect, it } from "bun:test";
import { matchTemplateTokenPrefix } from "./templateToken";

describe("matchTemplateTokenPrefix", () => {
  it("matches a bare open {{ (empty query)", () => {
    expect(matchTemplateTokenPrefix('fileName: "{{')).toEqual({ from: 11, query: "" });
  });
  it("matches a partial token name after {{", () => {
    expect(matchTemplateTokenPrefix("{{da")).toEqual({ from: 0, query: "da" });
  });
  it("allows offset/format chars in the query", () => {
    expect(matchTemplateTokenPrefix("{{date:")).toEqual({ from: 0, query: "date:" });
    expect(matchTemplateTokenPrefix("{{date+1")).toEqual({ from: 0, query: "date+1" });
  });
  it("returns null once the token is closed", () => {
    expect(matchTemplateTokenPrefix("{{date}}")).toBeNull();
    expect(matchTemplateTokenPrefix("{{date}} jour")).toBeNull();
  });
  it("returns null with no open {{", () => {
    expect(matchTemplateTokenPrefix("plain text")).toBeNull();
    expect(matchTemplateTokenPrefix("a { b")).toBeNull();
  });
  it("returns null when non-token chars follow {{", () => {
    expect(matchTemplateTokenPrefix("{{date }")).toBeNull(); // space breaks it
  });
});
