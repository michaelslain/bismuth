/* app/src/intro/VaultIntro.tsx — first-run "open your vault" intro.
   A full-window takeover shown only on first launch (gated in index.tsx). A short
   slideshow: welcome -> choose your theme -> three brains -> daemon -> claude -> begin.
   The theme step shows a real 3D knowledge graph (dummy unlabeled nodes, the app's own
   WebGL renderer); clicking a theme option recolors it live to that palette, and the SAME
   graph carries into the "Three brains, one mind" slide. The picked theme also re-themes
   the whole takeover and seeds the new vault's appearance.theme (written by the Tauri
   `choose_first_vault` command on the CTA). Reuses the standard ui/ buttons + theme system. */
import { For, Show, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { Icon } from "../icons/Icon";
import { WebGLRenderer } from "../graph/WebGLRenderer";
import { GraphAtmosphere } from "../graph/GraphAtmosphere";
import { paletteToInts, hexToInt } from "../themeColors";
import type { GraphData } from "../../../core/src/graph";
import { THEME_NAMES, THEMES, THEME_LABELS, DEFAULT_THEME, resolveAppearance, type ThemeName } from "../themes";
import { settingsToCssVars, setCssVars } from "../settingsCssVars";
import { DEFAULTS, DEFAULT_ACCENT_PALETTE } from "../settings";
import { isTauri } from "../nativeMenu";
import { CrystalStage, DaemonStage, ClaudeStage, Lockup } from "./marks";
import "./VaultIntro.css";

type SlideKey = "welcome" | "theme" | "graph" | "daemon" | "claude" | "powerups" | "begin";
type Slide = { key: SlideKey; tag: string; title: string; body: string; cta?: string };

// Optional power-ups offered on the power-ups slide. `cmd` matches a command-palette id; the
// chosen ones run via the SAME api the command palette uses, right after the vault opens (the
// intro itself has no backend). `relay` auto-loads in terminal tabs, so it's on-by-default info.
const POWER_UPS: { id: string; cmd?: string; icon: string; name: string; desc: string }[] = [
  { id: "daemon", cmd: "daemon-setup", icon: "Bot", name: "DAEMON", desc: "A background agent that runs crons and weaves memory while you're away." },
  { id: "cli", cmd: "bismuth-install", icon: "SquareTerminal", name: "CLI + MCP", desc: "Drive your vault from the shell, and let Claude read the docs + write bases." },
];

const SLIDES: Slide[] = [
  {
    key: "welcome",
    tag: "WELCOME",
    title: "Notes that think.",
    body: "Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.",
  },
  {
    key: "theme",
    tag: "MAKE IT YOURS",
    title: "Pick your palette.",
    body: "Choose a theme for your vault. You can change it anytime from settings.",
  },
  {
    key: "graph",
    tag: "THE KNOWLEDGE GRAPH",
    title: "Three brains, one mind.",
    body: "Your notes and Bismuth's memory connect into one graph, so what you know and what it learns stay woven together.",
  },
  {
    key: "daemon",
    tag: "DAEMON",
    title: "An agent that never sleeps.",
    body: "A background daemon runs on a schedule: folding new memory into your graph, re-linking notes, and surfacing what you'd forgotten.",
  },
  {
    key: "claude",
    tag: "CLAUDE CODE",
    title: "Let Claude tend it.",
    body: "Bismuth speaks MCP. Claude can search the docs and write your bases, queries, and notes for you, right from the terminal.",
  },
  {
    key: "powerups",
    tag: "POWER-UPS",
    title: "Optional power-ups.",
    body: "Pick what to set up. Bismuth turns them on once you open your vault, or you can do it anytime from the command palette.",
  },
  {
    key: "begin",
    tag: "BEGIN",
    title: "Open your vault.",
    body: "Pick a folder and Bismuth makes it a vault. Start writing, and the graph fills itself in.",
    cta: "Enter your vault",
  },
];

// localStorage key the post-restart app reads to run the chosen power-ups against the real backend.
const POWERUPS_KEY = "oa-first-run-powerups";

// All themes (dark + light) in one list for the selector dropdown.
const THEME_OPTIONS = THEME_NAMES.map((n) => ({ value: n, label: THEME_LABELS[n] }));

// Build a point-cloud graph with BAKED positions (a seeded random sphere). Baking positions
// means the renderer draws the layout directly — no cold force-settle, no auto-fit race — so
// it frames any node count instantly and reliably. The "you" hub sits at the center.
function makeCloud(n: number, radius: number, seed: number): GraphData {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const nodes: GraphData["nodes"] = [
    { id: "you", label: "", kind: "self", position: [0, 0, 0], position2d: [0, 0] },
  ];
  for (let i = 0; i < n; i++) {
    const r = radius * Math.cbrt(rnd());
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    nodes.push({
      id: `n${i}`,
      label: "",
      kind: "note",
      community: i % 5,
      position: [x, y, z] as [number, number, number],
      position2d: [x, y] as [number, number],
    });
  }
  const edges: GraphData["edges"] = [];
  for (let i = 0; i < n; i++) {
    if (i % 6 === 0) edges.push({ from: "you", to: `n${i}`, kind: "link" });
    if (i >= 7) edges.push({ from: `n${i - 7}`, to: `n${i}`, kind: "link" });
  }
  return { nodes, edges };
}

// Theme slide: a small starter cloud (just enough to show the palette). Three-brains slide:
// a whole vault's worth of notes (~the size of a real Bismuth vault) — the explosion.
const SMALL_GRAPH = makeCloud(54, 300, 1234567);
const BIG_GRAPH = makeCloud(1874, 760, 987654321);

// The renderer caches settled node positions in localStorage under these keys (shared with
// the app's GraphView). The intro's dummy graphs must NOT read stale cached positions (they'd
// restore nodes off-screen) or persist their own into the app — so we wipe them on enter+exit.
const GRAPHPOS_KEYS = ["oa-graphpos:v5:2d", "oa-graphpos:v5:3d"];
const clearGraphPosCache = () => {
  try {
    for (const k of GRAPHPOS_KEYS) localStorage.removeItem(k);
  } catch {
    /* private mode — non-fatal */
  }
};

// Push the chosen theme's colors into a renderer. Shared by both IntroGraph instances.
function applyGraphConfig(renderer: WebGLRenderer, name: ThemeName) {
  const ap = THEMES[name];
  const palette = ap.accentPalette?.length ? ap.accentPalette : DEFAULT_ACCENT_PALETTE;
  renderer.setConfig({
    spin: true,
    spinSpeed: 0.0016,
    palette: paletteToInts(palette),
    repulsion: -12,
    linkDistance: 6,
    centering: 0.13,
    nodeSize: 8,
    viewMode: "3d",
    showGraphLabels: false,
    graphLabelHubCount: 0,
    nodeSizeMinMult: 0.7,
    nodeSizeDegreeGain: 0.5,
    nodeSizeMaxMult: 3.5,
    edgeColor: hexToInt(ap.neutral, 0xaeb4c2),
    edgeOpacity: ap.isLight ? 0.22 : 0.34,
    // Transparent canvas so the .vi-root radial gradient shows THROUGH the graph.
    transparent: true,
    backgroundColor: hexToInt(ap.background, 0x14151b),
    labelTextColor: "rgba(0,0,0,0)",
    labelBgColor: "rgba(0,0,0,0)",
    selfColor: hexToInt(ap.foreground, 0xffffff),
  });
}

// One self-contained 3D graph instance (its own renderer + canvas + atmosphere). Renders its
// baked-layout graph ONCE (framed instantly, no settle/auto-fit motion), recolors on theme
// change, and pauses when not `active`. The intro mounts two — a small full-bleed cloud for the
// theme slide and a big condensed one for "three brains" — and cross-fades between them via the
// `.active` opacity transition, so there's no shared instance and no re-render on slide change.
function IntroGraph(props: { graph: GraphData; pose: "full" | "condensed"; active: boolean; theme: ThemeName; offsetY?: number; fitMargin?: number }) {
  let host!: HTMLDivElement;
  const renderer = new WebGLRenderer();
  let mounted = false;
  onMount(() => {
    renderer.mount(host, () => {});
    renderer.render(props.graph);
    mounted = true;
    applyGraphConfig(renderer, props.theme);
    if (props.fitMargin) renderer.setFitMargin(props.fitMargin); // zoom the cloud out a touch
    // Shift the graph itself (not the canvas) so it can sit in the upper area while the canvas
    // stays full-bleed (seamless with the page). 0 = centered.
    renderer.setFrameOffsetY(props.offsetY ?? 0);
    renderer.setVisible(props.active);
  });
  onCleanup(() => renderer.destroy());
  createEffect(() => mounted && applyGraphConfig(renderer, props.theme));
  createEffect(() => mounted && renderer.setVisible(props.active));
  return (
    <div class="vi-graph3d" data-pose={props.pose} classList={{ active: props.active }}>
      <div class="vi-graph3d-canvas" ref={host} />
      <GraphAtmosphere renderer={renderer} />
    </div>
  );
}

export default function VaultIntro() {
  const [i, setI] = createSignal(0);
  const [themeName, setThemeName] = createSignal<ThemeName>(DEFAULT_THEME);
  const [busy, setBusy] = createSignal(false);
  // Selected power-up ids — both default on. Re-running their setup is idempotent, so it's
  // safe to leave checked even when already installed (CLI+MCP re-syncs on boot, daemon
  // auto-updates on launch).
  const [powerups, setPowerups] = createSignal<string[]>(["daemon", "cli"]);
  const togglePowerup = (id: string) =>
    setPowerups((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const last = SLIDES.length - 1;
  const slide = () => SLIDES[i()];
  const theme = themeName; // a single theme name (dark + light are just entries in the list)
  // The theme step and the knowledge-graph step both show the SAME persistent 3D graph.
  const isGraphSlide = () => slide().key === "theme" || slide().key === "graph";

  const go = (k: number) => setI(Math.max(0, Math.min(last, k)));
  const next = () => (i() === last ? enterVault() : go(i() + 1));
  const prev = () => go(i() - 1);
  const skip = () => go(last); // jump to the CTA rather than bailing — there's no vault yet

  const varsFor = (name: ThemeName) => settingsToCssVars({ ...DEFAULTS, appearance: { ...DEFAULTS.appearance, theme: name } });

  // First-run is backend-free; clear the renderer's shared position cache on enter+exit so the
  // intro's baked-layout graphs never read stale layouts or leak positions into the app cache.
  onMount(clearGraphPosCache);
  onCleanup(clearGraphPosCache);

  // Live re-theme: paint the chosen theme onto the whole takeover. Each IntroGraph recolors its
  // own renderer separately (see the component below). No persistence here — only on commit
  // (enterVault) — so browsing the picker never pollutes the shared theme cache.
  createEffect(() => {
    const name = theme();
    setCssVars(varsFor(name));
    document.documentElement.style.colorScheme = resolveAppearance({ theme: name }).isLight ? "light" : "dark";
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "Escape") {
      e.preventDefault();
      skip();
    }
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  // The CTA: open the native folder picker, write the vault (with the chosen theme),
  // and relaunch into it. The Rust command does the work + app.restart().
  // Replay (secret keybind) launches the intro with a vault ALREADY configured — the CTA then
  // continues into it instead of forcing a re-pick.
  const hasVault = () => (window as unknown as { __OA_HAS_VAULT__?: boolean }).__OA_HAS_VAULT__ === true;

  const enterVault = async () => {
    if (busy()) return;
    if (isTauri()) {
      setBusy(true);
      try {
        // Persist the chosen power-ups (command-palette ids) for the post-restart app to run
        // against the real backend — the intro itself has none. Idempotent, so safe on replay.
        const cmds = powerups()
          .map((id) => POWER_UPS.find((p) => p.id === id)?.cmd)
          .filter((c): c is string => !!c);
        localStorage.setItem(POWERUPS_KEY, JSON.stringify(cmds));
        // Cache the chosen theme vars for the post-restart first paint.
        localStorage.setItem("oa-theme-vars-v1", JSON.stringify(varsFor(theme())));
      } catch {
        /* private mode — non-fatal */
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // Always open the folder picker — lets the user open an existing vault or create a new one.
        const ok = await invoke<boolean>("choose_first_vault", { theme: theme(), icon: DEFAULTS.appearance.icon });
        if (!ok) setBusy(false); // picker cancelled — stay on the intro
        // on success the app restarts; nothing more to do here
      } catch (e) {
        console.error("enter vault failed", e);
        setBusy(false);
      }
    } else {
      // Browser preview (?intro=1): no native picker / backend. The desktop app does the real thing.
      console.info("[intro] Enter your vault — native folder picker is available in the desktop app.");
    }
  };

  // Per-slide hero visual when it's NOT a graph slide (the graph stays mounted underneath).
  const nonGraphVisual = () => {
    switch (slide().key) {
      case "welcome":
        return <CrystalStage icon={DEFAULTS.appearance.icon} size={252} />;
      case "begin":
        return <CrystalStage icon={DEFAULTS.appearance.icon} size={220} />;
      case "daemon":
        return <DaemonStage />;
      case "claude":
        return <ClaudeStage />;
      default:
        return null;
    }
  };

  return (
    <div class="vi-root v-A">
      {/* Two independent 3D graphs that cross-fade (opacity) between the theme + graph slides:
          a small full-bleed starter cloud, and a big condensed "three brains" cloud. Separate
          instances → no shared renderer, no re-render/auto-fit motion on slide change. */}
      <IntroGraph graph={SMALL_GRAPH} pose="full" active={slide().key === "theme"} theme={theme()} />
      <IntroGraph graph={BIG_GRAPH} pose="condensed" active={slide().key === "graph"} theme={theme()} offsetY={0.12} fitMargin={1.55} />

      {/* floating header overlay — logo top-left, skip top-right, above the content */}
      <header class="vi-top">
        {/* hide the corner mark on slides that already show the big centered logo */}
        <Show when={slide().key !== "welcome" && slide().key !== "begin"} fallback={<span />}>
          <Lockup icon={DEFAULTS.appearance.icon} />
        </Show>
        <IconButton icon="X" label="Skip intro" onClick={skip} />
      </header>

      <div class="vi-center" data-slide={slide().key}>
        {/* per-slide non-graph hero (crystal / terminal) — the persistent graph stays
            mounted behind everything, so this only shows on non-graph slides. Keyed on
            the slide key so the block remounts (and its enter animation replays) on each
            slide change. */}
        <Show when={!isGraphSlide() && slide().key !== "powerups" && slide().key} keyed>
          {(_key) => (
            <div class="vi-hero">
              <div class="vi-hero-overlay">{nonGraphVisual()}</div>
            </div>
          )}
        </Show>

        <Show when={slide().key === "theme"}>
          <div class="vi-themes">
            <Select
              class="vi-theme-select"
              value={themeName()}
              onChange={(v) => setThemeName(v as ThemeName)}
              options={THEME_OPTIONS}
            />
          </div>
        </Show>

        <Show when={slide().key === "powerups"}>
          <div class="vi-powerups">
            <For each={POWER_UPS}>
              {(p) => {
                const selectable = !!p.cmd;
                const on = () => !selectable || powerups().includes(p.id);
                return (
                  <button
                    type="button"
                    class="vi-powerup"
                    classList={{ selected: on(), locked: !selectable }}
                    aria-pressed={on()}
                    onClick={() => selectable && togglePowerup(p.id)}
                  >
                    <span class="vi-powerup-top">
                      <Icon value={p.icon} size={16} />
                      <span class="vi-powerup-name">{p.name}</span>
                      <Show when={on()}>
                        <Icon value="Check" size={14} class="vi-powerup-check" />
                      </Show>
                    </span>
                    <span class="vi-powerup-desc">{p.desc}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        {/* copy block — keyed on the slide key so it remounts each slide change and the
            fade-up enter animation replays (the persistent graph behind it never remounts) */}
        <Show when={slide()} keyed>
          {(s) => (
            <div class="vi-copy">
              <div class="vi-tag">{s.tag}</div>
              <h1 class="vi-title">{s.title}</h1>
              <p class="vi-body">{s.body}</p>
            </div>
          )}
        </Show>

        <div class="vi-nav">
          <IconButton icon="ArrowLeft" label="Back" size="md" onClick={prev} disabled={i() === 0} />
          <div class="vi-dots">
            <For each={SLIDES}>
              {(_, k) => (
                <button
                  type="button"
                  class="vi-dot"
                  classList={{ on: k() === i() }}
                  aria-label={`Go to slide ${k() + 1}`}
                  onClick={() => go(k())}
                />
              )}
            </For>
          </div>
          <Show
            when={i() === last}
            fallback={<IconButton icon="ArrowRight" label="Next" variant="selected" size="md" onClick={next} />}
          >
            <TextButton variant="selected" size="md" onClick={next} disabled={busy()}>
              {busy() ? "OPENING…" : "ENTER YOUR VAULT"}
            </TextButton>
          </Show>
        </div>
      </div>
    </div>
  );
}
