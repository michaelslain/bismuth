// app/src/SettingsPage.tsx
// The settings page, rendered as a tab. Reads/writes the global settings store;
// every change applies live (appearance via CSS vars, graph via renderer.setConfig,
// editor by rebuilding its extensions). A single scrolling column of sections.
import { createSignal, onMount, For, type JSX } from "solid-js";
import { api } from "./api";
import {
  settings,
  setSettings,
  resetSettings,
  EDITOR_FONTS,
  PALETTE_KEYS,
  type Settings as S,
} from "./settings";

// --- small presentational helpers ---------------------------------------

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section style={{ "margin-bottom": "28px" }}>
      <h2 style={{ "font-size": "12px", "text-transform": "uppercase", "letter-spacing": "0.08em", opacity: 0.5, margin: "0 0 10px" }}>
        {props.title}
      </h2>
      <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "16px", padding: "8px 0", "border-bottom": "1px solid var(--border)" }}>
      <div style={{ "min-width": 0 }}>
        <div>{props.label}</div>
        {props.hint && <div style={{ "font-size": "11px", opacity: 0.45, "margin-top": "2px" }}>{props.hint}</div>}
      </div>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-shrink": 0 }}>{props.children}</div>
    </div>
  );
}

function Toggle(props: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => props.onChange(!props.value)}
      style={{
        width: "40px", height: "22px", "border-radius": "11px", border: "none", cursor: "pointer", position: "relative",
        background: props.value ? "var(--accent)" : "color-mix(in srgb, var(--fg) 25%, transparent)", transition: "background 120ms",
      }}
      aria-pressed={props.value}
    >
      <span style={{
        position: "absolute", top: "2px", left: props.value ? "20px" : "2px", width: "18px", height: "18px",
        "border-radius": "50%", background: "#fff", transition: "left 120ms",
      }} />
    </button>
  );
}

const selectStyle: JSX.CSSProperties = {
  background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--border)",
  "border-radius": "5px", padding: "4px 8px", "font-family": "inherit", "font-size": "12px", cursor: "pointer",
};

function Slider(props: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
        style={{ width: "140px", "accent-color": "var(--accent)" }}
      />
      <span style={{ width: "52px", "text-align": "right", "font-variant-numeric": "tabular-nums", opacity: 0.7 }}>
        {props.value}
      </span>
    </>
  );
}

// --- the page -------------------------------------------------------------

export function SettingsPage() {
  const [vault, setVault] = createSignal<string>("…");
  const [backupMsg, setBackupMsg] = createSignal<string>("");

  onMount(async () => {
    try {
      const cfg = await api.config();
      setVault(cfg.vault);
    } catch {
      setVault("(core not reachable)");
    }
  });

  const set = <K extends keyof S>(section: K, key: keyof S[K], value: S[K][keyof S[K]]) =>
    setSettings(section, key as any, value as any);

  const backupNow = async () => {
    setBackupMsg("Backing up…");
    try {
      await api.backup();
      setBackupMsg("✓ Snapshot saved");
    } catch {
      setBackupMsg("✗ Backup failed");
    }
    setTimeout(() => setBackupMsg(""), 2500);
  };

  return (
    <div style={{ "max-width": "620px", margin: "0 auto", padding: "28px 28px 60px" }}>
      <div style={{ display: "flex", "align-items": "baseline", "justify-content": "space-between", "margin-bottom": "24px" }}>
        <h1 style={{ "font-size": "20px", margin: 0 }}>Settings</h1>
        <button onClick={resetSettings} style={{ ...selectStyle }}>Reset to defaults</button>
      </div>

      <Section title="Appearance">
        <Row label="Accent color">
          <input
            type="color"
            value={settings.appearance.accent}
            onInput={(e) => set("appearance", "accent", e.currentTarget.value)}
            style={{ width: "36px", height: "26px", padding: 0, border: "1px solid var(--border)", "border-radius": "5px", background: "none", cursor: "pointer" }}
          />
        </Row>
        <Row label="Theme">
          <select
            style={selectStyle}
            value={settings.appearance.theme}
            onChange={(e) => set("appearance", "theme", e.currentTarget.value as S["appearance"]["theme"])}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Row>
        <Row label="Editor font">
          <select
            style={selectStyle}
            value={settings.appearance.editorFont}
            onChange={(e) => set("appearance", "editorFont", e.currentTarget.value)}
          >
            <For each={EDITOR_FONTS}>{(f) => <option value={f}>{f}</option>}</For>
          </select>
        </Row>
        <Row label="Editor font size">
          <Slider
            value={settings.appearance.editorFontSize}
            min={11}
            max={28}
            step={1}
            onChange={(v) => set("appearance", "editorFontSize", v)}
          />
        </Row>
      </Section>

      <Section title="Graph">
        <Row label="Spin" hint="Idle rotation of the graph">
          <Toggle value={settings.graph.spin} onChange={(v) => set("graph", "spin", v)} />
        </Row>
        <Row label="Spin speed">
          <Slider
            value={settings.graph.spinSpeed}
            min={0}
            max={0.01}
            step={0.0005}
            onChange={(v) => set("graph", "spinSpeed", v)}
          />
        </Row>
        <Row label="Node palette">
          <select
            style={selectStyle}
            value={settings.graph.palette}
            onChange={(e) => set("graph", "palette", e.currentTarget.value)}
          >
            <For each={PALETTE_KEYS}>{(p) => <option value={p}>{p}</option>}</For>
          </select>
        </Row>
        <Row label="Repulsion" hint="More negative = nodes push apart harder">
          <Slider
            value={settings.graph.repulsion}
            min={-40}
            max={-1}
            step={1}
            onChange={(v) => set("graph", "repulsion", v)}
          />
        </Row>
        <Row label="Link distance">
          <Slider
            value={settings.graph.linkDistance}
            min={1}
            max={40}
            step={1}
            onChange={(v) => set("graph", "linkDistance", v)}
          />
        </Row>
        <Row label="Centering" hint="Pull toward the center — higher = denser ball">
          <Slider
            value={settings.graph.centering}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => set("graph", "centering", v)}
          />
        </Row>
        <Row label="Node size">
          <Slider
            value={settings.graph.nodeSize}
            min={2}
            max={16}
            step={1}
            onChange={(v) => set("graph", "nodeSize", v)}
          />
        </Row>
        <Row label="Show labels" hint="Always show the open file, You, and the top hubs in the graph">
          <Toggle value={settings.graph.showGraphLabels} onChange={(v) => set("graph", "showGraphLabels", v)} />
        </Row>
        <Row label="Always-labeled hubs" hint="How many of the most-connected nodes always get a label">
          <Slider
            value={settings.graph.graphLabelHubCount}
            min={0}
            max={30}
            step={1}
            onChange={(v) => set("graph", "graphLabelHubCount", v)}
          />
        </Row>
      </Section>

      <Section title="Editor">
        <Row label="Live preview" hint="Render markdown inline as you type">
          <Toggle value={settings.editor.livePreview} onChange={(v) => set("editor", "livePreview", v)} />
        </Row>
        <Row label="Line numbers">
          <Toggle value={settings.editor.lineNumbers} onChange={(v) => set("editor", "lineNumbers", v)} />
        </Row>
        <Row label="Line wrapping">
          <Toggle value={settings.editor.lineWrapping} onChange={(v) => set("editor", "lineWrapping", v)} />
        </Row>
        <Row label="Auto-save delay" hint="Milliseconds of idle before saving">
          <Slider
            value={settings.editor.autoSaveDelay}
            min={200}
            max={3000}
            step={100}
            onChange={(v) => set("editor", "autoSaveDelay", v)}
          />
        </Row>
      </Section>

      <Section title="Vault & backup">
        <Row label="Vault path" hint="Set at launch — change requires restarting core">
          <code
            style={{
              "font-size": "11px",
              opacity: 0.7,
              "max-width": "260px",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {vault()}
          </code>
        </Row>
        <Row label="Backup on save" hint="Take a git snapshot after every save">
          <Toggle value={settings.vault.backupOnSave} onChange={(v) => set("vault", "backupOnSave", v)} />
        </Row>
        <Row label="Manual backup">
          <span style={{ "font-size": "11px", opacity: 0.6 }}>{backupMsg()}</span>
          <button style={selectStyle} onClick={backupNow}>
            Backup now
          </button>
        </Row>
      </Section>
    </div>
  );
}
