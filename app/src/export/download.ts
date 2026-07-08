// app/src/export/download.ts
// Save export bytes — with the WRITE result treated as authoritative, then REVEAL the
// delivered file in the OS file explorer so the user is taken straight to it.
//
// The packaged app used to toast "Exported … to Downloads" purely because the write call
// RESOLVED, without ever checking a file actually landed — so any silently-misdelivered
// write (fs-scope/TCC denial surfacing oddly, an unexpected downloadDir, or the browser
// anchor fallback running inside WKWebView, which performs NO downloads) produced a
// success toast and no file. Delivery now works like this:
//
//   - Tauri (desktop): write via the fs plugin to the REAL user Downloads dir
//     (path.downloadDir()), then VERIFY the file exists (fs.exists) before reporting
//     success. If the write throws or the file provably isn't there, fall back to the
//     native Save dialog (user picks a location — dialog-granted paths are always
//     fs-scope-allowed), write there, and verify again. Only a landed write returns;
//     everything else throws with the attempted path so the toast tells the truth. On a
//     landed write we REVEAL the file in Finder (opener plugin `revealItemInDir`) — best
//     effort, so "I don't see it in Downloads" is answered by the OS selecting the file
//     for the user regardless of how their Downloads is sorted.
//   - Browser (dev): Blob + <a download> anchor click, as before. The browser owns the
//     download from there (we can't stat it), so the result is reported as "browser".
//
// Verify-edge nuance (write-threw vs exists-threw): a write that THROWS is a real failure
// (fall back to the Save dialog). A write that RESOLVES but whose file is provably absent
// (exists() === false) is the old packaged-app lie (also a failure). But exists() itself
// THROWING — e.g. on an OLD binary that lacks the fs:allow-exists capability — must NOT be
// treated as a write failure: the write resolved, so we report success as UNVERIFIED
// rather than wrongly popping a Save dialog on a Downloads write that likely succeeded.
//
// The Tauri side is injectable (TauriDelivery) so the routing + verify + reveal logic is
// unit-testable without a webview (download.test.ts); the real seam lazy-imports the
// plugins exactly like before.
import { isTauri } from "../nativeMenu";

/** The impure Tauri surface deliverFile needs — injectable for tests. */
export interface TauriDelivery {
  /** Absolute path of the user's real Downloads directory. */
  downloadDir(): Promise<string>;
  join(dir: string, name: string): Promise<string>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** True only if the file provably exists after writing. May THROW if unavailable. */
  exists(path: string): Promise<boolean>;
  /** Native "Save as…" dialog; resolves the chosen absolute path or null on cancel. */
  saveDialog(defaultName: string): Promise<string | null>;
  /** Reveal (and select) the file in the OS file explorer. Best-effort — may throw/no-op. */
  reveal(path: string): Promise<void>;
}

export type Delivery =
  | { via: "tauri"; path: string; verified: boolean } // landed at `path`; `verified` iff exists() confirmed it
  | { via: "browser" };                               // handed to the browser's download machinery

/** The real plugin-backed seam (lazy imports keep the plugins out of non-Tauri paths). */
async function realTauriDelivery(): Promise<TauriDelivery> {
  const fs = await import("@tauri-apps/plugin-fs");
  const path = await import("@tauri-apps/api/path");
  const dialog = await import("@tauri-apps/plugin-dialog");
  return {
    downloadDir: () => path.downloadDir(),
    join: (dir, name) => path.join(dir, name),
    writeFile: (p, bytes) => fs.writeFile(p, bytes),
    exists: (p) => fs.exists(p),
    saveDialog: (defaultName) => dialog.save({ defaultPath: defaultName, title: "Save export" }),
    reveal: async (p) => {
      // `opener:default` already grants `allow-reveal-item-in-dir` (see capabilities/default.json).
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.revealItemInDir(p);
    },
  };
}

/** Browser fallback: Blob + <a download> anchor click. */
function anchorDownload(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Did we PROVE the file landed (`exists()` returned true), or just fail to check? */
type WriteOutcome = "verified" | "unverified";

// Write bytes to `target`, then try to confirm the file is really there. Three outcomes:
//   - writeFile THROWS        → a real write failure; propagates so the caller can fall back.
//   - exists() === false      → the write resolved but nothing landed (the old packaged-app
//                               lie); throw so we never report unverified success.
//   - exists() THROWS         → existence can't be checked (e.g. an old binary without the
//                               fs:allow-exists capability). The write itself RESOLVED, so
//                               return "unverified" instead of forcing the Save-dialog
//                               fallback on a write that most likely succeeded.
//   - exists() === true       → "verified".
async function writeChecked(t: TauriDelivery, target: string, bytes: Uint8Array): Promise<WriteOutcome> {
  await t.writeFile(target, bytes);
  let present: boolean;
  try {
    present = await t.exists(target);
  } catch {
    return "unverified"; // write resolved; we simply couldn't confirm — don't treat as failure
  }
  if (!present) {
    throw new Error(`write reported success but no file exists at ${target}`);
  }
  return "verified";
}

// Reveal `path` in the OS file explorer, selected — never let a reveal failure fail an
// export (Finder/opener quirks, unsupported platform, etc. are all swallowed).
async function revealBestEffort(t: TauriDelivery, path: string, reveal: boolean): Promise<void> {
  if (!reveal) return;
  try {
    await t.reveal(path);
  } catch {
    /* reveal is a courtesy — the file is already written; never fail the export over it */
  }
}

/**
 * Deliver export bytes to the user. Desktop: verified write into the OS Downloads dir,
 * with a native Save-dialog fallback; resolves the REAL absolute path written and reveals
 * it in Finder. Browser: anchor download. Throws (never lies) when nothing verifiably
 * landed — including when the user cancels the fallback dialog.
 *
 * `tauri` overrides the delivery seam for tests; `null` forces the browser path. When
 * omitted, the environment decides (isTauri()). `reveal` (default true) opens the OS file
 * explorer with the delivered file selected — callers writing several files in a loop pass
 * `reveal` only for the first so the user gets a single Finder window, not one per file.
 */
export async function deliverFile(
  filename: string,
  bytes: Uint8Array,
  mime: string,
  tauri?: TauriDelivery | null,
  browserDownload: (filename: string, bytes: Uint8Array, mime: string) => void = anchorDownload,
  reveal = true,
): Promise<Delivery> {
  const t = tauri === undefined ? (isTauri() ? await realTauriDelivery() : null) : tauri;
  if (!t) {
    browserDownload(filename, bytes, mime);
    return { via: "browser" };
  }

  // Primary: the OS Downloads directory.
  let target = "";
  let primaryError: Error | null = null;
  try {
    target = await t.join(await t.downloadDir(), filename);
    const outcome = await writeChecked(t, target, bytes);
    await revealBestEffort(t, target, reveal);
    return { via: "tauri", path: target, verified: outcome === "verified" };
  } catch (e) {
    primaryError = e as Error;
  }

  // Fallback: let the user pick a destination via the native Save dialog. A path granted
  // through the dialog is user-consented (and auto-allowed by the fs scope), so this works
  // even when Downloads itself is blocked (e.g. macOS Files-and-Folders permission denied).
  const chosen = await t.saveDialog(filename);
  if (!chosen) {
    throw new Error(
      `couldn't write ${target || filename} (${primaryError?.message ?? "unknown error"}) and the save dialog was cancelled — nothing was exported`,
    );
  }
  let outcome: WriteOutcome;
  try {
    outcome = await writeChecked(t, chosen, bytes);
  } catch (e) {
    throw new Error(`couldn't write ${chosen}: ${(e as Error).message}`);
  }
  await revealBestEffort(t, chosen, reveal);
  return { via: "tauri", path: chosen, verified: outcome === "verified" };
}

/**
 * Write export bytes into a specific (absolute) folder the user picked via the native
 * dialog — the "output path". Tauri only; the browser can't write to an arbitrary folder,
 * so callers fall back to {@link deliverFile} there. Returns the absolute path written,
 * VERIFIED to exist (a resolved-but-missing write throws instead of reporting success).
 * Requires the folder to be inside the app's fs capability scope (see capabilities/default.json).
 * `reveal` (default true) selects the written file in Finder; multi-file callers pass it only
 * for the first file so the user gets one Finder window rather than one per file.
 */
export async function writeToFolder(
  folder: string,
  filename: string,
  bytes: Uint8Array,
  tauri?: TauriDelivery,
  reveal = true,
): Promise<string> {
  const t = tauri ?? (isTauri() ? await realTauriDelivery() : null);
  if (!t) throw new Error("Writing to a chosen folder is only available in the desktop app");
  const target = await t.join(folder, filename);
  try {
    await writeChecked(t, target, bytes);
  } catch (e) {
    throw new Error(`couldn't write ${target}: ${(e as Error).message}`);
  }
  await revealBestEffort(t, target, reveal);
  return target;
}
