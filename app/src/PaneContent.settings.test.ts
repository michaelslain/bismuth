// app/src/PaneContent.settings.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), "utf8");

describe("settings opens as an editor tab", () => {
  it("App.tsx gear opens settings.yaml, not the ::settings sentinel", () => {
    const app = src("App.tsx");
    expect(app).toContain('openFile("settings.yaml")');
  });

  it("PaneContent.tsx no longer references SettingsPage", () => {
    const pc = src("PaneContent.tsx");
    expect(pc).not.toContain("SettingsPage");
  });
});
