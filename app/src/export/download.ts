// app/src/export/download.ts
// Save export bytes — with the WRITE result treated as authoritative.
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
//     fs-scope-allowed), write there, and verify again. Only a verified write returns;
//     everything else throws with the attempted path so the toast tells the truth.
//   - Browser (dev): Blob + <a download> anchor click, as before. The browser owns the
//     download from there (we can't stat it), so the result is reported as "browser".
//
// The Tauri side is injectable (TauriDelivery) so the routing + verify logic is
// unit-testable without a webview (download.test.ts); the real seam lazy-imports the
// plugins exactly like before.
import { isTauri } from "../nativeMenu";

/** The impure Tauri surface deliverFile needs — injectable for tests. */
export interface TauriDelivery {
  /** Absolute path of the user's real Downloads directory. */
  downloadDir(): Promise<string>;
  join(dir: string, name: string): Promise<string>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** True only if the file provably exists after writing. */
  exists(path: string): Promise<boolean>;
  /** Native "Save as…" dialog; resolves the chosen absolute path or null on cancel. */
  saveDialog(defaultName: string): Promise<string | null>;
}

export type Delivery =
  | { via: "tauri"; path: string } // verified on disk at `path`
  | { via: "browser" };            // handed to the browser's download machinery

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

// Write bytes to `target` and confirm the file is really there. A resolved writeFile whose
// file doesn't exist afterwards is treated as a failure — never report unverified success.
async function writeVerified(t: TauriDelivery, target: string, bytes: Uint8Array): Promise<void> {
  await t.writeFile(target, bytes);
  if (!(await t.exists(target))) {
    throw new Error(`write reported success but no file exists at ${target}`);
  }
}

/**
 * Deliver export bytes to the user. Desktop: verified write into the OS Downloads dir,
 * with a native Save-dialog fallback; resolves the REAL absolute path written. Browser:
 * anchor download. Throws (never lies) when nothing verifiably landed — including when the
 * user cancels the fallback dialog.
 *
 * `tauri` overrides the delivery seam for tests; `null` forces the browser path. When
 * omitted, the environment decides (isTauri()).
 */
export async function deliverFile(
  filename: string,
  bytes: Uint8Array,
  mime: string,
  tauri?: TauriDelivery | null,
  browserDownload: (filename: string, bytes: Uint8Array, mime: string) => void = anchorDownload,
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
    await writeVerified(t, target, bytes);
    return { via: "tauri", path: target };
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
  try {
    await writeVerified(t, chosen, bytes);
  } catch (e) {
    throw new Error(`couldn't write ${chosen}: ${(e as Error).message}`);
  }
  return { via: "tauri", path: chosen };
}

/**
 * Write export bytes into a specific (absolute) folder the user picked via the native
 * dialog — the "output path". Tauri only; the browser can't write to an arbitrary folder,
 * so callers fall back to {@link deliverFile} there. Returns the absolute path written,
 * VERIFIED to exist (a resolved-but-missing write throws instead of reporting success).
 * Requires the folder to be inside the app's fs capability scope (see capabilities/default.json).
 */
export async function writeToFolder(
  folder: string,
  filename: string,
  bytes: Uint8Array,
  tauri?: TauriDelivery,
): Promise<string> {
  const t = tauri ?? (isTauri() ? await realTauriDelivery() : null);
  if (!t) throw new Error("Writing to a chosen folder is only available in the desktop app");
  const target = await t.join(folder, filename);
  try {
    await writeVerified(t, target, bytes);
  } catch (e) {
    throw new Error(`couldn't write ${target}: ${(e as Error).message}`);
  }
  return target;
}
