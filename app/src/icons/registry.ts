// app/src/icons/registry.ts
//
// Binds the pure registry (registry-core.ts) to lucide-solid's icons.
//
// PERF: the full lucide manifest is ~1,715 icons (~80-110 KB gz). Importing it
// here (`import { icons } from "lucide-solid"`) pulled the whole set into the
// always-eager entry chunk via Icon.tsx. Instead we:
//   1. Seed a SMALL static core of the icons visible in the first frame
//      (toolbar/file-tree/tab UI) via per-icon subpath imports, which tree-shake
//      so only those icons land in the entry.
//   2. Lazily `import("lucide-solid")` (off the entry, on idle) for the full set,
//      which covers arbitrary frontmatter / toolbar / folder icons and the picker.
//   3. Swap to the full registry once it resolves. `resolveIcon` reads a signal,
//      so <Icon> re-renders reactively: a custom icon shows its text fallback for
//      a beat, then becomes the real glyph — never silently lost.
//
// All resolution logic lives in registry-core so it stays unit-testable without
// importing lucide-solid (which throws when imported outside a DOM).
import { createSignal } from "solid-js";
import type { LucideIcon } from "lucide-solid";
import { createIconRegistry, type IconEntry, type IconRegistry } from "./registry-core";

// --- Static boot core (per-icon subpath imports → tree-shaken into the entry) ---
import AppWindow from "lucide-solid/icons/app-window";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ArrowRight from "lucide-solid/icons/arrow-right";
import Book from "lucide-solid/icons/book";
import Brain from "lucide-solid/icons/brain";
import Calendar from "lucide-solid/icons/calendar";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Clock from "lucide-solid/icons/clock";
import Copy from "lucide-solid/icons/copy";
import Crown from "lucide-solid/icons/crown";
import Download from "lucide-solid/icons/download";
import Eye from "lucide-solid/icons/eye";
import File from "lucide-solid/icons/file";
import FilePlus from "lucide-solid/icons/file-plus";
import FileText from "lucide-solid/icons/file-text";
import Folder from "lucide-solid/icons/folder";
import FolderOpen from "lucide-solid/icons/folder-open";
import FolderPlus from "lucide-solid/icons/folder-plus";
import Hash from "lucide-solid/icons/hash";
import Image from "lucide-solid/icons/image";
import Link from "lucide-solid/icons/link";
import Menu from "lucide-solid/icons/menu";
import Minus from "lucide-solid/icons/minus";
import Network from "lucide-solid/icons/network";
import Notebook from "lucide-solid/icons/notebook";
import PanelLeft from "lucide-solid/icons/panel-left";
import Pencil from "lucide-solid/icons/pencil";
import PenTool from "lucide-solid/icons/pen-tool";
import Plus from "lucide-solid/icons/plus";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Repeat from "lucide-solid/icons/repeat";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Search from "lucide-solid/icons/search";
import Server from "lucide-solid/icons/server";
import Settings from "lucide-solid/icons/settings";
import Share from "lucide-solid/icons/share";
import SquareTerminal from "lucide-solid/icons/square-terminal";
import Star from "lucide-solid/icons/star";
import Table from "lucide-solid/icons/table";
import Tag from "lucide-solid/icons/tag";
import Trash2 from "lucide-solid/icons/trash-2";
import Users from "lucide-solid/icons/users";
import X from "lucide-solid/icons/x";
import Zap from "lucide-solid/icons/zap";

const SEED: Record<string, LucideIcon> = {
  AppWindow, ArrowLeft, ArrowRight, Book, Brain, Calendar, Check, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Crown, Download, Eye, File,
  FilePlus, FileText, Folder, FolderOpen, FolderPlus, Hash, Image, Link, Menu,
  Minus, Network, Notebook, PanelLeft, Pencil, PenTool, Plus, RefreshCw, Repeat,
  RotateCcw, Search, Server, Settings, Share, SquareTerminal, Star, Table, Tag,
  Trash2, Users, X, Zap,
} as unknown as Record<string, LucideIcon>;

const seedRegistry = createIconRegistry<LucideIcon>(SEED);

// Full registry, loaded lazily off the entry. The signal drives the reactive swap.
const [fullRegistry, setFullRegistry] = createSignal<IconRegistry<LucideIcon> | null>(null);

let loadStarted = false;
/** Idempotently load the full lucide manifest (async, off the entry chunk). */
function ensureFullRegistry(): void {
  if (loadStarted) return;
  loadStarted = true;
  import("lucide-solid")
    .then((m) => {
      setFullRegistry(() =>
        createIconRegistry<LucideIcon>(m.icons as unknown as Record<string, LucideIcon>),
      );
    })
    .catch(() => {
      // Keep the seed registry; failing to fetch the full set just means uncommon
      // icons stay as text fallback. Don't wedge the loadStarted latch open forever.
      loadStarted = false;
    });
}

// Kick the full-set load off on idle so it doesn't compete with boot-critical
// fetches (/graph, /settings). WKWebView lacks requestIdleCallback — fall back.
const scheduleIdle: (cb: () => void) => void =
  typeof requestIdleCallback === "function"
    ? (cb) => requestIdleCallback(cb)
    : (cb) => setTimeout(cb, 200);
scheduleIdle(ensureFullRegistry);

/**
 * Resolve an icon spec (a Lucide name in any casing, the legacy "Li"/"Lu"
 * convention, or an emoji/arbitrary glyph) to a Lucide component, or `null`
 * when it isn't a known icon (caller should render the raw glyph as text).
 *
 * Reactive: reads the full-registry signal, so once the lazy manifest resolves
 * any <Icon> calling this re-renders from the text fallback to the real glyph.
 */
export const resolveIcon = (spec: string | null | undefined): LucideIcon | null => {
  const full = fullRegistry();
  if (full) {
    const hit = full.resolve(spec);
    if (hit) return hit;
  }
  return seedRegistry.resolve(spec);
};

/** True when `spec` names a Lucide icon (vs. an emoji / arbitrary glyph). */
export const isIconName = (spec: string | null | undefined): boolean => resolveIcon(spec) !== null;

/** Every Lucide icon (canonical name + component), sorted by name. For the picker. */
export const allIcons = (): IconEntry<LucideIcon>[] => {
  ensureFullRegistry();
  return (fullRegistry() ?? seedRegistry).all();
};

/** All canonical icon names, sorted — for autocomplete suggestions. */
export const iconNames = (): string[] => {
  ensureFullRegistry();
  return (fullRegistry() ?? seedRegistry).names();
};
