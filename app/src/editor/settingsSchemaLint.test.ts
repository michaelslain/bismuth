// app/src/editor/settingsSchemaLint.test.ts
// In settings mode the WHOLE document is the YAML body (settings.yaml has no
// frontmatter fence), so diagnosticsForFrontmatter must validate the entire doc
// against SETTINGS_SCHEMA rather than looking for a `---` slice.
import { describe, expect, it } from "bun:test";
import { diagnosticsForFrontmatter } from "./yamlSchema";
import { SETTINGS_SCHEMA } from "../../../core/src/schema/settingsSchema";

const allow = () => true;

describe("settings-mode whole-document validation", () => {
  it("flags a wrong-typed nested setting on a fenceless settings.yaml", () => {
    // The whole document is validated (no `---` fence). A boolean field given a
    // string surfaces a schema diagnostic mapped to a real document offset.
    const doc = "graph:\n  spin: nope\n";
    const diags = diagnosticsForFrontmatter(doc, SETTINGS_SCHEMA, allow, "settings");
    expect(diags.length).toBeGreaterThan(0);
    // maps to the document, not an empty result
    expect(diags[0].from).toBeGreaterThanOrEqual(0);
  });

  it("flags an unknown top-level section as a warning", () => {
    const doc = "appearance:\n  theme: oxide-duotone\nbogusSection:\n  x: 1\n";
    const diags = diagnosticsForFrontmatter(doc, SETTINGS_SCHEMA, allow, "settings");
    expect(diags.some((d) => d.message.includes("unknown property"))).toBe(true);
  });

  it("produces no diagnostics for a fully-valid settings.yaml", () => {
    const doc = "appearance:\n  theme: oxide-duotone\n  editorFontSize: 16\n";
    const diags = diagnosticsForFrontmatter(doc, SETTINGS_SCHEMA, allow, "settings");
    expect(diags).toEqual([]);
  });

  it("flags an invalid enum value", () => {
    const doc = "appearance:\n  theme: rainbow\n";
    const diags = diagnosticsForFrontmatter(doc, SETTINGS_SCHEMA, allow, "settings");
    expect(diags.length).toBeGreaterThan(0);
  });

  it("frontmatter mode is unchanged: fenceless doc yields no diagnostics", () => {
    const doc = "appearance:\n  editorFontSize: 999\n";
    const diags = diagnosticsForFrontmatter(doc, SETTINGS_SCHEMA, allow, "frontmatter");
    expect(diags).toEqual([]);
  });
});
