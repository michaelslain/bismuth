import { test, expect, describe } from "bun:test";
import {
  splitModelSuffix,
  modelsCorrespond,
  modelOptionFor,
  modelLabelFor,
  resolveInitialModel,
  reconcileManifestModel,
} from "./chatModelResolution";

// Bug #89: "chat not saving model per session." Two clobbers are guarded by these rules:
//  (1) ordering — the old code persisted manifest.model BEFORE reading the user's choice, so the
//      reapply step always compared the choice against itself and no-op'd;
//  (2) namespace — the picker/persisted values are ALIASES ("opus[1m]", "haiku") while each init
//      manifest reports the FULLY-RESOLVED id ("claude-opus-4-8[1m]", "claude-haiku-4-5-20251001",
//      verified against a live CLI). Treating the two as comparable strings overwrote the alias with
//      the full id on the first turn of every chat, deselecting the picker and corrupting the
//      persisted choice — the reason the bug kept bouncing after the ordering fix.

// The real supported-models list observed live (values are aliases, NOT resolved ids).
const OPTIONS = [
  { value: "default", label: "Default (recommended)" },
  { value: "opus[1m]", label: "Opus" },
  { value: "claude-fable-5[1m]", label: "Fable" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

describe("splitModelSuffix", () => {
  test("splits the [1m] context-variant suffix off", () => {
    expect(splitModelSuffix("opus[1m]")).toEqual({ base: "opus", oneM: true });
    expect(splitModelSuffix("claude-opus-4-8[1m]")).toEqual({ base: "claude-opus-4-8", oneM: true });
  });
  test("plain values have no suffix", () => {
    expect(splitModelSuffix("haiku")).toEqual({ base: "haiku", oneM: false });
    expect(splitModelSuffix("")).toEqual({ base: "", oneM: false });
  });
});

describe("modelsCorrespond (alias ↔ resolved-id tolerance)", () => {
  test("exact values correspond", () => {
    expect(modelsCorrespond("haiku", "haiku")).toBe(true);
    expect(modelsCorrespond("claude-opus-4-8[1m]", "claude-opus-4-8[1m]")).toBe(true);
  });
  test("an alias corresponds to its resolved id (the live-CLI shape)", () => {
    // Observed live: setModel("haiku") → init reports "claude-haiku-4-5-20251001".
    expect(modelsCorrespond("haiku", "claude-haiku-4-5-20251001")).toBe(true);
    expect(modelsCorrespond("claude-haiku-4-5-20251001", "haiku")).toBe(true);
    expect(modelsCorrespond("sonnet", "claude-sonnet-4-5-20250929")).toBe(true);
    expect(modelsCorrespond("opus[1m]", "claude-opus-4-8[1m]")).toBe(true);
    // A dated form of an already-long alias.
    expect(modelsCorrespond("claude-fable-5[1m]", "claude-fable-5-20260101[1m]")).toBe(true);
  });
  test("the [1m] variant is a DIFFERENT model choice — suffixes must match", () => {
    expect(modelsCorrespond("sonnet", "claude-sonnet-4-5[1m]")).toBe(false);
    expect(modelsCorrespond("opus[1m]", "claude-opus-4-8")).toBe(false);
  });
  test("different families / versions never correspond", () => {
    expect(modelsCorrespond("haiku", "claude-sonnet-4-5-20250929")).toBe(false);
    expect(modelsCorrespond("claude-opus-4-5", "claude-opus-4-8")).toBe(false);
    expect(modelsCorrespond("opus", "opusplan")).toBe(false); // segment match, not substring match
  });
  test("'default' corresponds to anything (it aliases the CLI's own resolution)", () => {
    expect(modelsCorrespond("default", "claude-sonnet-4-5-20250929")).toBe(true);
    expect(modelsCorrespond("claude-opus-4-8[1m]", "default")).toBe(true);
  });
  test("empty values never correspond", () => {
    expect(modelsCorrespond("", "haiku")).toBe(false);
    expect(modelsCorrespond("haiku", "")).toBe(false);
    expect(modelsCorrespond("", "")).toBe(false);
  });
});

describe("modelOptionFor (resolved id → picker option)", () => {
  test("exact option value wins", () => {
    expect(modelOptionFor("haiku", OPTIONS)).toBe("haiku");
    expect(modelOptionFor("default", OPTIONS)).toBe("default");
  });
  test("a resolved id maps to its alias option", () => {
    expect(modelOptionFor("claude-haiku-4-5-20251001", OPTIONS)).toBe("haiku");
    expect(modelOptionFor("claude-opus-4-8[1m]", OPTIONS)).toBe("opus[1m]");
    expect(modelOptionFor("claude-sonnet-4-5-20250929", OPTIONS)).toBe("sonnet");
  });
  test("never maps through the 'default' wildcard option", () => {
    // An id with no matching family must NOT get swallowed by "default"-matches-everything.
    expect(modelOptionFor("claude-nova-1-0", OPTIONS)).toBeNull();
  });
  test("empty value / empty options → null", () => {
    expect(modelOptionFor("", OPTIONS)).toBeNull();
    expect(modelOptionFor("claude-haiku-4-5-20251001", [])).toBeNull();
  });
});

describe("modelLabelFor", () => {
  test("shows the option label for a resolved id", () => {
    expect(modelLabelFor("claude-opus-4-8[1m]", OPTIONS)).toBe("Opus");
    expect(modelLabelFor("haiku", OPTIONS)).toBe("Haiku");
  });
  test("falls back to the raw value when nothing matches", () => {
    expect(modelLabelFor("claude-nova-1-0", OPTIONS)).toBe("claude-nova-1-0");
    expect(modelLabelFor("", OPTIONS)).toBe("");
  });
});

describe("resolveInitialModel — FRESH sessions (spawn default vs the user's persisted choice)", () => {
  test("adopts the session's own model when there's no persisted choice yet", () => {
    expect(resolveInitialModel("", "claude-sonnet-4-5", false)).toEqual({ adopt: "claude-sonnet-4-5" });
  });
  test("decides nothing when neither side knows a model (fresh synthetic manifest)", () => {
    expect(resolveInitialModel("", "", false)).toBeNull();
  });
  test("no-op when the persisted alias corresponds to the reported resolved id (the clobber case)", () => {
    // The persisted "opus[1m]" IS the running "claude-opus-4-8[1m]" — enforcing here would be a
    // pointless churn, and adopting the id would corrupt the alias. Nothing to do.
    expect(resolveInitialModel("opus[1m]", "claude-opus-4-8[1m]", false)).toBeNull();
    expect(resolveInitialModel("claude-opus-4-5", "claude-opus-4-5", false)).toBeNull();
  });
  test("enforces the persisted choice when the session spawned with a different model (the bug)", () => {
    expect(resolveInitialModel("claude-opus-4-5", "claude-sonnet-4-5", false)).toEqual({ enforce: "claude-opus-4-5" });
    expect(resolveInitialModel("opus[1m]", "claude-sonnet-4-5-20250929", false)).toEqual({ enforce: "opus[1m]" });
  });
  test("enforces over an EMPTY reported model (the spawn-time synthetic manifest)", () => {
    expect(resolveInitialModel("haiku", "", false)).toEqual({ enforce: "haiku" });
  });
  test("enforces even when the persisted value came from the GLOBAL fallback key, not a per-chat one", () => {
    // resolveInitialModel doesn't know or care where `persisted` came from — readLastModel's
    // per-chat/global fallback resolution happens before this is called.
    expect(resolveInitialModel("claude-haiku-4-5", "claude-sonnet-4-5", false)).toEqual({ enforce: "claude-haiku-4-5" });
  });
});

describe("resolveInitialModel — RESUMED sessions (the session owns its model)", () => {
  test("adopts the session's own saved model, never enforcing the tab/global fallback over it", () => {
    // Tab says haiku (its last conversation), but the RESUMED session was set to opus[1m] — the
    // session wins. This is the "no path may fall back to the global default for a session that
    // has a saved model" requirement.
    expect(resolveInitialModel("haiku", "opus[1m]", true)).toEqual({ adopt: "opus[1m]" });
  });
  test("adopts even when there's no persisted value at all", () => {
    expect(resolveInitialModel("", "opus[1m]", true)).toEqual({ adopt: "opus[1m]" });
  });
  test("decides NOTHING when the resumed manifest carries no model info", () => {
    // A pre-fix session with no server-side entry: the CLI restores its own model — pushing the
    // tab/global fallback here would clobber it. Wait for the first real init instead.
    expect(resolveInitialModel("haiku", "", true)).toBeNull();
  });
});

describe("reconcileManifestModel — LATER manifests (manifest late-arrival / mid-session change)", () => {
  test("no reported model decides nothing", () => {
    expect(reconcileManifestModel("haiku", "", OPTIONS)).toBeNull();
  });
  test("the resolved form of the current choice is NOT drift (the first-turn clobber case)", () => {
    // First turn after enforcing "opus[1m]": init reports "claude-opus-4-8[1m]". The old code
    // rememberModel'd the id here, corrupting the persisted alias + deselecting the picker.
    expect(reconcileManifestModel("opus[1m]", "claude-opus-4-8[1m]", OPTIONS)).toBeNull();
    expect(reconcileManifestModel("haiku", "claude-haiku-4-5-20251001", OPTIONS)).toBeNull();
  });
  test("'default' as the current choice is never fought", () => {
    expect(reconcileManifestModel("default", "claude-sonnet-4-5-20250929", OPTIONS)).toBeNull();
  });
  test("a genuine mid-session model change is adopted, mapped into picker-space", () => {
    // e.g. the user ran /model in the composer — the session really changed; follow the truth.
    expect(reconcileManifestModel("haiku", "claude-sonnet-4-5-20250929", OPTIONS)).toEqual({ adopt: "sonnet" });
    expect(reconcileManifestModel("sonnet", "claude-opus-4-8[1m]", OPTIONS)).toEqual({ adopt: "opus[1m]" });
  });
  test("adopts the raw id when the models frame hasn't landed / the model is unknown", () => {
    expect(reconcileManifestModel("haiku", "claude-sonnet-4-5-20250929", [])).toEqual({ adopt: "claude-sonnet-4-5-20250929" });
    expect(reconcileManifestModel("haiku", "claude-nova-1-0", OPTIONS)).toEqual({ adopt: "claude-nova-1-0" });
  });
  test("no current choice at all adopts the reported model", () => {
    expect(reconcileManifestModel("", "claude-haiku-4-5-20251001", OPTIONS)).toEqual({ adopt: "haiku" });
  });
});
