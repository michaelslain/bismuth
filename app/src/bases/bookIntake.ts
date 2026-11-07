// app/src/bases/bookIntake.ts
// Page intake for the book view: dropped (or picked) images and PDFs are copied into the vault's
// attachment folder and each becomes one `{ page: "[[<path>]]" }` row, appended in drop order.
// Takes browser `File`s or native OS paths — the same two paths cardImageDrop.ts documents; the
// caller (the book view) owns the hit-testing and passes whichever arrived.
import { api } from '../api'
import { settings } from '../settings'
import { pushToast } from '../ui/ToastHost'
import { attachmentTarget } from '../attachmentPath'
import { basename } from '../fileIntake'
import { isImagePath, isPdfPath } from '../../../core/src/fileKinds'

export type IntakeDeps = {
    uploadAsset: (target: string, bytes: ArrayBuffer) => Promise<string>
    rowCreate: (file: string, note: Record<string, unknown>) => Promise<unknown>
    toast: (message: string) => void
    /** Bytes of a native OS path (Tauri fs plugin under the app). */
    readNative: (path: string) => Promise<ArrayBuffer>
    attachmentFolder: () => string
}

export const REJECT_TOAST = 'only images and PDFs can be pages'

const isPageFile = (f: { name: string }) => isImagePath(f.name) || isPdfPath(f.name)

export async function readNativeBytes(path: string): Promise<ArrayBuffer> {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    return await new Blob([bytes as BlobPart]).arrayBuffer()
}

const realDeps: IntakeDeps = {
    uploadAsset: (target, bytes) => api.uploadAsset(target, bytes),
    rowCreate: (file, note) => api.rowCreate(file, note),
    toast: message => void pushToast(message),
    readNative: readNativeBytes,
    attachmentFolder: () => settings.attachments.folder,
}

/** Copy every image / PDF in `input` into the vault and append one row per file to the base at
 *  `basePath`, in order. Returns the vault paths that became pages. */
export async function intakeFiles(
    input: { files?: File[]; paths?: string[] },
    basePath: string,
    deps: IntakeDeps = realDeps,
): Promise<string[]> {
    const incoming: { name: string; bytes: () => Promise<ArrayBuffer> }[] = []
    let rejected = false
    for (const f of input.files ?? []) {
        if (isPageFile(f)) incoming.push({ name: f.name, bytes: () => f.arrayBuffer() })
        else rejected = true
    }
    for (const p of input.paths ?? []) {
        const name = basename(p)
        if (isPageFile({ name }))
            incoming.push({ name, bytes: () => deps.readNative(p) })
        else rejected = true
    }
    if (rejected) deps.toast(REJECT_TOAST)

    const landed: string[] = []
    for (const item of incoming) {
        try {
            const target = attachmentTarget(deps.attachmentFolder(), item.name, basePath)
            const path = await deps.uploadAsset(target, await item.bytes())
            await deps.rowCreate(basePath, { page: `[[${path}]]` })
            landed.push(path)
        } catch (e) {
            deps.toast(`couldn't add ${item.name}: ${(e as Error).message}`)
        }
    }
    return landed
}
