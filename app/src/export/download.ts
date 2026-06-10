// app/src/export/download.ts
// Save bytes to the user's Downloads folder. Tauri: write via fs plugin. Browser: anchor download.
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
