// app/src/themeGuard.test.ts
// The SAFETY NET for the centralized color system (core/src/theme/tokens.ts →
// settingsCssVars projection → CSS var()). Three invariants:
//   1. Every theme yields every ColorTokens field (no theme is missing a token).
//   2. settingsToCssVars projects the full contract of semantic + palette tokens
//      for EVERY theme — the same key set for all — so no CSS var() is ever unset.
//   3. No CSS var(--x) is "dangling": referenced with no inline fallback yet never
//      projected, defined, or explicitly whitelisted.
// Written before the refactor and kept committed: it fails loudly if a token stops
// being projected, a theme drops a field, or a stylesheet references a phantom var.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, THEME_NAMES, resolveTheme, type ColorTokens } from "./themes";
import { settingsToCssVars } from "./settingsCssVars";
import { DEFAULTS } from "./settings";

const APP_SRC = dirname(fileURLToPath(import.meta.url));

/** ColorTokens fields every theme MUST define (the base palette). */
const REQUIRED_TOKEN_FIELDS: (keyof ColorTokens)[] = [
  "background", "foreground", "neutral", "accent", "border", "surface", "surface2", "accentPalette",
];

/** CSS custom properties settingsToCssVars MUST project for EVERY theme — the projection
 *  contract every stylesheet relies on. Includes the semantic + elevation tokens that this
 *  refactor centralized (previously hardcoded in App.css :root, dark-only). */
const REQUIRED_PROJECTED = [
  // base chrome
  "--bg", "--fg", "--accent", "--border", "--border-soft", "--text-muted", "--faint",
  "--panel", "--surface-1", "--surface-2", "--surface-3", "--hover-bg",
  // accent + category ramp
  "--teal", "--blue", "--violet", "--green", "--gold", "--rose", "--grad",
  "--accent-soft", "--accent-purple", "--on-accent",
  "--graph-0", "--graph-1", "--graph-2", "--graph-3", "--graph-4",
  // semantic status (centralized here — must be per-theme, not a dark-only literal)
  "--danger", "--success", "--warning",
  // elevation (centralized here — light themes get lighter shadows)
  "--shadow-menu", "--shadow-popup", "--shadow-card", "--shadow-modal",
];

/** CSS vars intentionally left unprojected (documented escape hatches). */
const VAR_WHITELIST = new Set<string>([
  "--lo",        // user decision 2026-07-21: undefined on purpose → inherits --hi brightness. Do NOT define.
  "--chat-tint", // set inline per-pane by ChatView.tsx (JS style binding), never global.
]);

function withTheme(theme: string) {
  return { ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme } } as typeof DEFAULTS;
}

function walkCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist") continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walkCss(p, out);
    else if (e.endsWith(".css")) out.push(p);
  }
  return out;
}

describe("theme guard — every theme yields every token", () => {
  it("resolveTheme returns all required ColorTokens fields for every theme", () => {
    for (const name of THEME_NAMES) {
      const t = resolveTheme(name);
      for (const f of REQUIRED_TOKEN_FIELDS) {
        expect(t[f], `${name}.${String(f)}`).toBeDefined();
      }
      expect(t.accentPalette.length, `${name}.accentPalette length`).toBeGreaterThanOrEqual(5);
      for (const c of t.accentPalette) expect(c, `${name} palette hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("light themes are flagged isLight; dark themes are not", () => {
    for (const name of THEME_NAMES) {
      const isLight = name.endsWith("-light");
      expect(!!resolveTheme(name).isLight, name).toBe(isLight);
    }
  });
});

describe("theme guard — projection contract", () => {
  it("settingsToCssVars projects every required token for EVERY theme, all non-empty", () => {
    for (const name of THEME_NAMES) {
      const vars = settingsToCssVars(withTheme(name));
      for (const key of REQUIRED_PROJECTED) {
        const v = vars[key];
        expect(v, `${name} ${key}`).toBeDefined();
        expect(String(v).trim().length, `${name} ${key} non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it("every theme produces the SAME set of projected keys (no theme drops a var)", () => {
    const ref = new Set(Object.keys(settingsToCssVars(withTheme(THEME_NAMES[0]))));
    for (const name of THEME_NAMES.slice(1)) {
      const keys = new Set(Object.keys(settingsToCssVars(withTheme(name))));
      expect([...ref].filter((k) => !keys.has(k)), `${name} missing keys`).toEqual([]);
      expect([...keys].filter((k) => !ref.has(k)), `${name} extra keys`).toEqual([]);
    }
  });
});

describe("theme guard — semantic + elevation tokens re-theme (light ≠ dark)", () => {
  const dark = settingsToCssVars(withTheme("oxide-duotone"));
  const light = settingsToCssVars(withTheme("oxide-duotone-light"));

  it("danger/success/warning have their own accessible light values, not the dark-tuned ones", () => {
    for (const key of ["--danger", "--success", "--warning"]) {
      expect(light[key], `${key} light`).not.toBe(dark[key]);
    }
  });

  it("light shadows are lighter than the dark ones (not rgba(0,0,0,…))", () => {
    for (const key of ["--shadow-menu", "--shadow-popup", "--shadow-card", "--shadow-modal"]) {
      expect(light[key], `${key} light differs`).not.toBe(dark[key]);
      expect(light[key], `${key} light not pure-black`).not.toContain("rgba(0, 0, 0");
    }
  });
});

describe("theme guard — no dangling CSS var", () => {
  it("every var(--x) without an inline fallback is projected, defined, or whitelisted", () => {
    const files = walkCss(APP_SRC);
    const projected = new Set(Object.keys(settingsToCssVars(DEFAULTS)));
    const defined = new Set<string>();
    for (const f of files) {
      const css = readFileSync(f, "utf8");
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
      for (const m of css.matchAll(/@property\s+(--[a-z0-9-]+)/gi)) defined.add(m[1]);
    }
    const dangling: string[] = [];
    for (const f of files) {
      const css = readFileSync(f, "utf8");
      // var(--x) immediately closed by ) → no inline fallback.
      for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
        const name = m[1];
        if (projected.has(name) || defined.has(name) || VAR_WHITELIST.has(name)) continue;
        dangling.push(`${name} in ${f.slice(APP_SRC.length + 1)}`);
      }
    }
    expect([...new Set(dangling)]).toEqual([]);
  });
});
