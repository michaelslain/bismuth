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
import { assertSeedMatchesNames } from "./seedNames";

// --- Static boot core (per-icon subpath imports → tree-shaken into the entry) ---
import AppWindow from "lucide-solid/icons/app-window";
import Archive from "lucide-solid/icons/archive";
import ArchiveX from "lucide-solid/icons/archive-x";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Blend from "lucide-solid/icons/blend";
import Book from "lucide-solid/icons/book";
import BookOpen from "lucide-solid/icons/book-open";
import Bot from "lucide-solid/icons/bot";
import Box from "lucide-solid/icons/box";
import Brain from "lucide-solid/icons/brain";
import BrainCircuit from "lucide-solid/icons/brain-circuit";
import Calendar from "lucide-solid/icons/calendar";
import CaseSensitive from "lucide-solid/icons/case-sensitive";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Clock from "lucide-solid/icons/clock";
import Code from "lucide-solid/icons/code";
import Columns3 from "lucide-solid/icons/columns-3";
import Copy from "lucide-solid/icons/copy";
import Crown from "lucide-solid/icons/crown";
import Database from "lucide-solid/icons/database";
import Download from "lucide-solid/icons/download";
import Eraser from "lucide-solid/icons/eraser";
import Eye from "lucide-solid/icons/eye";
import File from "lucide-solid/icons/file";
import FilePlus from "lucide-solid/icons/file-plus";
import FileText from "lucide-solid/icons/file-text";
import Folder from "lucide-solid/icons/folder";
import FolderOpen from "lucide-solid/icons/folder-open";
import FolderPlus from "lucide-solid/icons/folder-plus";
import Hash from "lucide-solid/icons/hash";
import Highlighter from "lucide-solid/icons/highlighter";
import Image from "lucide-solid/icons/image";
import Landmark from "lucide-solid/icons/landmark";
import LayoutList from "lucide-solid/icons/layout-list";
import Link from "lucide-solid/icons/link";
import Lock from "lucide-solid/icons/lock";
import Menu from "lucide-solid/icons/menu";
import MessageSquare from "lucide-solid/icons/message-square";
import Minus from "lucide-solid/icons/minus";
import Network from "lucide-solid/icons/network";
import Notebook from "lucide-solid/icons/notebook";
import PanelBottom from "lucide-solid/icons/panel-bottom";
import PanelLeft from "lucide-solid/icons/panel-left";
import PanelRight from "lucide-solid/icons/panel-right";
import Pen from "lucide-solid/icons/pen";
import Pencil from "lucide-solid/icons/pencil";
import PenTool from "lucide-solid/icons/pen-tool";
import Plus from "lucide-solid/icons/plus";
import Redo2 from "lucide-solid/icons/redo-2";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Regex from "lucide-solid/icons/regex";
import Repeat from "lucide-solid/icons/repeat";
import Replace from "lucide-solid/icons/replace";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Search from "lucide-solid/icons/search";
import Send from "lucide-solid/icons/send";
import Server from "lucide-solid/icons/server";
import Settings from "lucide-solid/icons/settings";
import Settings2 from "lucide-solid/icons/settings-2";
import Share from "lucide-solid/icons/share";
import Share2 from "lucide-solid/icons/share-2";
import Square from "lucide-solid/icons/square";
import SquarePlus from "lucide-solid/icons/square-plus";
import SquareTerminal from "lucide-solid/icons/square-terminal";
import Star from "lucide-solid/icons/star";
import Table from "lucide-solid/icons/table";
import Tag from "lucide-solid/icons/tag";
import Trash2 from "lucide-solid/icons/trash-2";
import Undo2 from "lucide-solid/icons/undo-2";
import Users from "lucide-solid/icons/users";
import Vote from "lucide-solid/icons/vote";
import WholeWord from "lucide-solid/icons/whole-word";
import Wrench from "lucide-solid/icons/wrench";
import X from "lucide-solid/icons/x";
import Zap from "lucide-solid/icons/zap";
import ZoomIn from "lucide-solid/icons/zoom-in";
import ZoomOut from "lucide-solid/icons/zoom-out";

// Every icon the app's own chrome can render on the first frame — toolbar +
// command palette, file tree, tab bar, graph toolbar, editor/find-replace and
// drawing toolbars. These are eagerly bundled (per-icon subpath imports, so they
// tree-shake) and therefore resolve SYNCHRONOUSLY — no blank/text flash. The
// only icons that fall back to the lazy full manifest are arbitrary *user* icons
// (note frontmatter, custom folder icons), which can't be known ahead of time.
//
// Keep this in sync with SEED_ICON_NAMES (the pure, lucide-free mirror used by
// tests): the assertion below throws on boot if they ever drift, and
// registry-seed.test.ts asserts every command-catalog icon is covered.
const SEED: Record<string, LucideIcon> = {
  AppWindow, Archive, ArchiveX, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Blend, Book, BookOpen,
  Bot, Box, Brain, BrainCircuit, Calendar, CaseSensitive, Check, ChevronDown,
  ChevronLeft, ChevronRight,
  ChevronUp, Clock, Code, Columns3, Copy, Crown, Database, Download, Eraser, Eye, File,
  FilePlus, FileText, Folder, FolderOpen, FolderPlus, Hash, Highlighter, Image,
  Landmark, LayoutList, Link, Lock, Menu, MessageSquare, Minus, Network, Notebook, PanelBottom, PanelLeft,
  PanelRight, Pen, Pencil, PenTool, Plus, Redo2, RefreshCw, Regex, Repeat,
  Replace, RotateCcw, Search, Send, Server, Settings, Settings2, Share, Share2, Square,
  SquarePlus, SquareTerminal, Star, Table, Tag, Trash2, Undo2, Users, Vote,
  WholeWord, Wrench, X, Zap, ZoomIn, ZoomOut,
} as unknown as Record<string, LucideIcon>;

// Boot guard: the eager import map and its pure name-mirror must list the exact
// same icons, so the test (which can't import lucide) stays trustworthy.
assertSeedMatchesNames(Object.keys(SEED));

const seedRegistry = createIconRegistry<LucideIcon>(SEED);

// Full registry, loaded lazily off the entry. The signal drives the reactive swap.
const [fullRegistry, setFullRegistry] = createSignal<IconRegistry<LucideIcon> | null>(null);

/** True once the full lucide manifest has resolved. <Icon> reads this to know
 *  whether an unresolved icon-name is still pending (show a blank placeholder)
 *  or genuinely unknown (full set is loaded, so render the raw glyph as text). */
export const fullRegistryLoaded = (): boolean => fullRegistry() !== null;

let loadStarted = false;
/** Idempotently load the full lucide manifest (async, off the entry chunk). */
export function ensureFullRegistry(): void {
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
