// app/src/settings.persist.test.ts
import { describe, expect, it } from "bun:test";
import { firstLaunchImport, DEFAULTS } from "./settings";
import { stringify } from "yaml";

describe("firstLaunchImport", () => {
  it("returns null when there is no legacy localStorage blob", () => {
    expect(firstLaunchImport(null, {})).toBeNull();
  });

  it("returns null when the server already has non-default settings", () => {
    const legacy = JSON.stringify({ appearance: { accent: "#111111" } });
    // server differs from defaults -> user already migrated; don't clobber
    const serverData = { appearance: { accent: "#999999" } };
    expect(firstLaunchImport(legacy, serverData)).toBeNull();
  });

  it("returns the merged settings to seed when legacy exists and server is bare defaults", () => {
    const legacy = JSON.stringify({ appearance: { accent: "#111111" } });
    // server == defaults (freshly initialized settings.yaml)
    const out = firstLaunchImport(legacy, structuredClone(DEFAULTS));
    expect(out).not.toBeNull();
    expect(out!.appearance.accent).toBe("#111111");
  });

  it("round-trips through yaml.stringify without throwing", () => {
    const legacy = JSON.stringify({ graph: { nodeSize: 9 } });
    const out = firstLaunchImport(legacy, structuredClone(DEFAULTS))!;
    expect(() => stringify(out)).not.toThrow();
  });
});
