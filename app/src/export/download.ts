// app/src/export/download.ts
// Save export bytes. Tauri: write via fs plugin (Downloads, or a user-chosen folder).
// Browser: anchor download (always lands in the browser's download location).
import { isTauri } from "../nativeMenu";

export async function downloadFile(filename: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (isTauri()) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const { downloadDir, join } = await import("@tauri-apps/api/path");
    const target = await join(await downloadDir(), filename);
    await writeFile(target, bytes);
    return;
  }
  // Browser dev preview: Blob + <a download>.
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Write export bytes into a specific (absolute) folder the user picked via the native
 * dialog — the "output path". Tauri only; the browser can't write to an arbitrary folder,
 * so callers fall back to {@link downloadFile} there. Returns the absolute path written.
 * Requires the folder to be inside the app's fs capability scope (see capabilities/default.json).
 */
export async function writeToFolder(folder: string, filename: string, bytes: Uint8Array): Promise<string> {
  if (!isTauri()) throw new Error("Writing to a chosen folder is only available in the desktop app");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  const target = await join(folder, filename);
  await writeFile(target, bytes);
  return target;
}
