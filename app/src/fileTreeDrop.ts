// app/src/fileTreeDrop.ts
// Pure planning for a drop of OS files (or native OS paths) onto the file tree: which of the
// dropped names the tree will accept, where each lands, and whether it needs a HEIC->JPEG
// conversion first. No I/O here — FileTree.tsx reads bytes and calls api.uploadAsset/convertHeic
// from this plan, so the routing/rejection logic stays unit-testable without a DOM or a backend.
import { isTreeListedName } from '../../core/src/fileKinds'
import { isHeicName, jpegNameFor } from './fileIntake'

export type TreeUploadPlan = {
    accepted: { name: string; target: string; convertHeic: boolean }[]
    rejected: string[]
}

/** Plan where each dropped file lands in the tree. `targetDir` is a folder path, or '' for the
 *  vault root — the file's basename joins onto it (no path traversal, no directory creation: the
 *  caller decided the folder before this runs). A HEIC/HEIF name is renamed to its `.jpg` sibling
 *  (and `convertHeic: true` set) BEFORE the tree-listed check, so a dropped photo is accepted and
 *  routed exactly like any other image — the caller transcodes the bytes via `api.convertHeic`
 *  before uploading to `target`. Anything the tree still doesn't list after that renaming
 *  (`isTreeListedName`, core/src/fileKinds.ts) is rejected, by its ORIGINAL name, so the caller's
 *  toast names the file the user actually dropped. */
export function planTreeUploads(
    targetDir: string,
    names: string[],
): TreeUploadPlan {
    const accepted: TreeUploadPlan['accepted'] = []
    const rejected: string[] = []
    for (const name of names) {
        const convertHeic = isHeicName(name)
        const finalName = jpegNameFor(name)
        if (!isTreeListedName(finalName)) {
            rejected.push(name)
            continue
        }
        const target = targetDir ? `${targetDir}/${finalName}` : finalName
        accepted.push({ name, target, convertHeic })
    }
    return { accepted, rejected }
}

/** The drop-target folder implied by the tree row/root a hit-test landed on: `''` for the tree
 *  root (`data-drop-root`), the folder's own path for a folder row (`data-drop-folder`), or null
 *  when neither attribute is present — the drop point isn't over the tree at all. `dropFolder`
 *  wins when (implausibly) both are set, since a folder row is strictly more specific than the
 *  root it sits inside. */
export function dropFolderFromAttrs(attrs: {
    dropFolder?: string | null
    dropRoot?: string | null
}): string | null {
    if (attrs.dropFolder != null) return attrs.dropFolder
    if (attrs.dropRoot != null) return ''
    return null
}
