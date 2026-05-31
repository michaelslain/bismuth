import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import type { WorkbookSnapshot } from "./snapshot";

export interface SheetHandle {
  /** Current workbook state as a plain JSON-serializable snapshot. */
  getSnapshot(): WorkbookSnapshot;
  /** Tear down the Univer instance and free the container. */
  dispose(): void;
}

export interface MountOptions {
  container: HTMLElement;
  /** Omit or pass {} for a fresh blank workbook. */
  data?: WorkbookSnapshot;
  /** Fired on every data-mutating command (caller debounces). */
  onChange: () => void;
}

export function mountSheet(opts: MountOptions): SheetHandle {
  const { univer, univerAPI } = createUniver({
    // NOTE: the enum member is EN_US ("enUS"). Using `En_US` is undefined and
    // silently registers the locale under the wrong key → raw `ui.ribbon.*` keys.
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
    presets: [UniverSheetsCorePreset({ container: opts.container })],
  });

  univerAPI.createWorkbook((opts.data ?? {}) as Record<string, unknown>);

  const sub = univerAPI.addEvent(univerAPI.Event.CommandExecuted, () => opts.onChange());

  return {
    getSnapshot: () => univerAPI.getActiveWorkbook().save() as WorkbookSnapshot,
    dispose: () => {
      try {
        sub?.dispose?.();
      } catch {
        /* already disposed */
      }
      univer.dispose();
    },
  };
}
