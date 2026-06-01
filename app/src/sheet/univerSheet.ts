import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "./univer-theme.css"; // app-cohesive restyle of Univer's chrome (scoped to .oa-sheet)
import "./univer-icons.css"; // re-skins Univer's toolbar icons with lucide (generated)
import type { WorkbookSnapshot } from "./snapshot";

export interface SheetHandle {
  /** Current workbook state as a plain JSON-serializable snapshot. */
  getSnapshot(): WorkbookSnapshot;
  /** Toggle Univer's dark mode at runtime (no remount needed). */
  setDark(dark: boolean): void;
  /** Tear down the Univer instance and free the container. */
  dispose(): void;
}

export interface MountOptions {
  container: HTMLElement;
  /** Omit or pass {} for a fresh blank workbook. */
  data?: WorkbookSnapshot;
  /** Fired on every data-mutating command (caller debounces). */
  onChange: () => void;
  /** Start in dark mode to match the app theme. */
  dark?: boolean;
}

export function mountSheet(opts: MountOptions): SheetHandle {
  // Univer mounts into — and disposes by detaching from — its container. Disposing
  // then re-creating into the SAME node renders blank, so give each instance a
  // fresh child element and remove it on dispose. This makes remounting (external
  // reload) reliable while keeping the caller's container stable.
  const root = document.createElement("div");
  root.className = "oa-sheet"; // scope hook for univer-theme.css
  root.style.width = "100%";
  root.style.height = "100%";
  opts.container.appendChild(root);

  const { univer, univerAPI } = createUniver({
    // NOTE: the enum member is EN_US ("enUS"). Using `En_US` is undefined and
    // silently registers the locale under the wrong key → raw `ui.ribbon.*` keys.
    locale: LocaleType.EN_US,
    darkMode: !!opts.dark,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        UniverPresetSheetsCoreEnUS,
        UniverPresetSheetsSortEnUS,
        UniverPresetSheetsFilterEnUS,
      ),
    },
    presets: [
      UniverSheetsCorePreset({ container: root }),
      UniverSheetsSortPreset(),
      UniverSheetsFilterPreset(),
    ],
  });

  univerAPI.createWorkbook((opts.data ?? {}) as Record<string, unknown>);

  // Default unstyled cells to the app's monospace so the sheet DATA matches the
  // chrome. Done before wiring onChange so it isn't counted as an edit — it becomes
  // part of the post-mount baseline the caller captures, so opening writes nothing.
  for (const ws of univerAPI.getActiveWorkbook()?.getSheets() ?? []) {
    ws.setDefaultStyle({ ff: "Monaspace Xenon" });
  }

  const sub = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => opts.onChange());

  return {
    getSnapshot: () => univerAPI.getActiveWorkbook()!.save() as unknown as WorkbookSnapshot,
    setDark: (dark: boolean) => univerAPI.toggleDarkMode(dark),
    dispose: () => {
      try {
        sub?.dispose?.();
      } catch {
        /* already disposed */
      }
      univer.dispose();
      root.remove();
    },
  };
}
