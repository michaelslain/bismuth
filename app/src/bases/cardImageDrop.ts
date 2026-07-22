// app/src/bases/cardImageDrop.ts
// The SHARED intake for "an image file was dropped onto a card" — the two surfaces that accept
// such a drop (the board's card face, KanbanView.tsx; the edit modal's description field,
// CardEditModal.tsx) both route through here so they upload, name, and embed identically.
//
// ── The two intake paths (this is NOT the in-app pointer drag) ────────────────────────────────
// An OS FILE drop is a different event path from Bismuth's in-app drags (dnd/viewDrag.ts, which
// are pointer-driven precisely because WKWebView's HTML5 DnD is broken). A file coming from
// Finder is delivered BY THE WEBVIEW, and we cannot synthesize it from pointer events — so we
// take it as the platform hands it over:
//   • Packaged app (WKWebView + Tauri): Tauri's native drag-drop handler is enabled, which
//     SUPPRESSES the HTML5 `drop` for external files. The drop arrives ONLY as the
//     `bismuth-native-drag` CustomEvent (nativeDrop.ts), carrying REAL on-disk paths → read via
//     the fs plugin. This is the path that matters in the real app.
//   • Plain browser (dev / claude-in-chrome): that event never fires; the HTML5
//     `dataTransfer.files` path serves instead.
// Mirrors Editor.tsx exactly — the same dual-path shape notes already use for image drops.
import { api } from "../api";
import { settings } from "../settings";
import { pushToast } from "../Toast";
import { isTauri } from "../nativeMenu";
import { nativeDropScale } from "../nativeDropRouting";
import type { NativeDragDetail } from "../nativeDrop";
import { attachmentTarget, baseName, imageEmbed, isImageFile, isImagePath } from "./kanbanImageDrop";

/** One image's bytes, ready to upload, keyed by the basename it should take in the vault. */
export type ImageUpload = { name: string; bytes: ArrayBuffer };

/** Does this HTML5 drag carry OS FILES (rather than an internal card/column reorder)? */
export function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes("Files");
}

/** The dropped browser Files that are images, read into uploads. Browser path only. */
export async function uploadsFromFiles(files: FileList | File[]): Promise<ImageUpload[]> {
  const out: ImageUpload[] = [];
  for (const f of Array.from(files)) {
    if (!isImageFile(f)) continue;
    try {
      out.push({ name: f.name, bytes: await f.arrayBuffer() });
    } catch (e) {
      pushToast(`Couldn't read ${f.name}`);
      console.error("file read failed", e);
    }
  }
  return out;
}

/** The dropped OS PATHS that are images, read into uploads via Tauri's fs plugin. Only reached
 *  under Tauri (the native event never fires in a browser), so the import is desktop-only. */
export async function uploadsFromNativePaths(paths: string[]): Promise<ImageUpload[]> {
  const images = paths.filter(isImagePath);
  if (images.length === 0) return [];
  let readFile: (p: string) => Promise<Uint8Array>;
  try {
    ({ readFile } = await import("@tauri-apps/plugin-fs"));
  } catch (e) {
    pushToast("Couldn't read dropped image — see console");
    console.error("fs plugin import failed", e);
    return [];
  }
  const out: ImageUpload[] = [];
  for (const p of images) {
    try {
      const bytes = await readFile(p);
      out.push({ name: baseName(p), bytes: await new Blob([bytes as BlobPart]).arrayBuffer() });
    } catch (e) {
      pushToast(`Couldn't read ${baseName(p)}`);
      console.error("native drop read failed", e);
    }
  }
  return out;
}

/** A forwarded native drop's cursor position in true page CSS px. The bridge already divided by
 *  DPR, but WebKit doesn't fold page zoom into devicePixelRatio — nativeDropScale measures the
 *  residual so the point lands on the element actually under the cursor (see nativeDropRouting).
 *  Same correction the editor's native-drop handler applies. */
export async function nativeDropPoint(d: NativeDragDetail): Promise<{ x: number; y: number }> {
  let f = 1;
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const size = await getCurrentWindow().innerSize();
      f = nativeDropScale(window.devicePixelRatio || 1, window.innerWidth, size.width);
    }
  } catch {
    f = 1;
  }
  return { x: d.x * f, y: d.y * f };
}

/** Copy each image into the vault's attachment folder (honoring `settings.attachments.folder`,
 *  resolved relative to `notePath`) and return the `![[basename]]` embed for each one that
 *  landed. Uses the SAME copy-into-attachments + wikilink-embed convention as a note-body image
 *  drop, so a card's picture is an ordinary vault attachment — nothing card-specific on disk. */
export async function uploadImageEmbeds(uploads: ImageUpload[], notePath: string | null): Promise<string[]> {
  const embeds: string[] = [];
  for (const u of uploads) {
    try {
      const finalPath = await api.uploadAsset(attachmentTarget(settings.attachments.folder, u.name, notePath), u.bytes);
      embeds.push(imageEmbed(baseName(finalPath)));
    } catch (e) {
      pushToast(`Couldn't save image: ${(e as Error).message}`);
    }
  }
  return embeds;
}
