// app/src/icons/seedNames.ts
//
// A pure, lucide-free mirror of the eager icon seed in `registry.ts`. It exists
// only so tests can reason about *which* icons are eagerly bundled without
// importing lucide-solid (which throws when imported outside a DOM — see
// registry-core.ts). registry.ts asserts at boot that its actual SEED map keys
// match this list, so the two can never silently drift.

/** Canonical PascalCase names of every eagerly-seeded (instant) icon. */
export const SEED_ICON_NAMES: readonly string[] = [
  "AppWindow", "Archive", "ArchiveX", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Blend", "Book",
  "BookOpen", "Bot", "Box", "Brain", "BrainCircuit", "Calendar", "CalendarX", "CaseSensitive",
  "Check", "ChevronDown",
  "ChevronLeft", "ChevronRight", "ChevronUp", "Clock", "Code", "Columns3",
  "Copy", "Crown", "Database", "Download", "Eraser", "Eye", "File", "FilePlus", "FileText",
  "Folder", "FolderOpen", "FolderPlus", "Hash", "Highlighter", "Image", "Inbox",
  "Landmark", "LayoutList", "Link", "Lock", "Menu", "MessageSquare", "Minus", "Network", "Notebook",
  "PanelBottom", "PanelLeft", "PanelRight", "Pen", "Pencil", "PenTool", "Plus",
  "Redo2", "RefreshCw", "Regex", "Repeat", "Replace", "RotateCcw", "Search", "Send",
  "Server", "Settings", "Settings2", "Share", "Share2", "Square", "SquarePlus",
  "SquareTerminal", "Star", "Table", "Tag", "Trash2", "Undo2", "Users", "Vote",
  "WholeWord", "Wrench", "X", "Zap", "ZoomIn", "ZoomOut",
];

/**
 * Throw if the live SEED map keys and SEED_ICON_NAMES don't list the exact same
 * icons. Called from registry.ts at module load — a forgotten import or a
 * forgotten name-mirror entry fails loudly in dev instead of shipping a
 * silently-flashing icon.
 */
export function assertSeedMatchesNames(seedKeys: string[]): void {
  const names = new Set(SEED_ICON_NAMES);
  const keys = new Set(seedKeys);
  const missingFromNames = seedKeys.filter((k) => !names.has(k));
  const missingFromSeed = SEED_ICON_NAMES.filter((n) => !keys.has(n));
  if (missingFromNames.length || missingFromSeed.length) {
    throw new Error(
      "icon seed drift — registry.ts SEED and seedNames.ts SEED_ICON_NAMES must match.\n" +
        (missingFromNames.length ? `  in SEED but not SEED_ICON_NAMES: ${missingFromNames.join(", ")}\n` : "") +
        (missingFromSeed.length ? `  in SEED_ICON_NAMES but not SEED: ${missingFromSeed.join(", ")}` : ""),
    );
  }
}
