import { describe, expect, it } from "bun:test";
import { MARK_NAMES, buildMark } from "./logoMarks";

describe("logo marks", () => {
  it("exposes the 14 named marks, hopper-crystal first", () => {
    expect(MARK_NAMES[0]).toBe("hopper-crystal");
    expect(MARK_NAMES).toEqual([
      "hopper-crystal", "node-b", "square-funnel", "nested-diamonds",
      "pinwheel", "node-crystal", "lattice", "diamond-bloom",
      "node-diamond", "octagon-bloom", "spin-cross", "tri-bloom",
      "radial-graph", "node-rings",
    ]);
  });

  it("every mark is a self-contained svg string", () => {
    for (const name of MARK_NAMES) {
      const svg = buildMark(name);
      expect(svg.startsWith("<svg"), `${name} starts with <svg`).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>"), `${name} closes`).toBe(true);
      expect(svg).toContain('viewBox="0 0 100 100"');
      const refs = [...svg.matchAll(/url\(#([a-z0-9-]+)\)/gi)].map((m) => m[1]);
      for (const id of refs) {
        expect(svg, `${name} inlines gradient #${id}`).toContain(`id="${id}"`);
      }
    }
  });

  it("matches the schema's appearance.icon enum", async () => {
    const { SETTINGS_SCHEMA } = await import("../../core/src/schema/settingsSchema");
    const appearance = (SETTINGS_SCHEMA.appearance.type as { fields: Record<string, { type: unknown; default?: unknown }> }).fields;
    const iconType = appearance.icon.type as { kind: string; values: string[] };
    expect(iconType.kind).toBe("enum");
    expect(iconType.values).toEqual([...MARK_NAMES]);
    expect(appearance.icon.default).toBe("hopper-crystal");
  });
});
