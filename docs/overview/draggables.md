# Draggables

A **draggable** is anything a person can pick up and drop on Bismuth: a file, an image, a link, a
run of text, a sidebar row, a tab, a pane. This page is the contract for which draggables every
drop surface must accept and what each drop does. A new drop surface, or a new kind of draggable,
updates the matrix below.

## The two transports

Every draggable arrives one of two ways, and a surface must handle both:

- **From outside the app** (Finder, a browser, Photos, Messages, another editor). In the packaged
  app Tauri's native drag-drop handler intercepts these and `app/src/nativeDrop.ts` re-broadcasts
  them as a `bismuth-native-drag` window event carrying real absolute paths and the cursor
  position. Each surface hit-tests that position against its own rect and claims the drop once
  (`nativeDropRouting.ts`'s `claimNativeDrop`). A drop with **no paths** (a browser image, a link,
  dragged text, a Photos/Messages file promise) is read off the OS drag pasteboard via the
  `read_drag_pasteboard` Tauri command and planned by `dropIntake.ts`'s `planDrop`. In a browser
  (dev) build the same drags arrive as HTML5 `drop` events and go through the same planner via
  `pasteboardFromTransfer`.
- **From inside the app** (sidebar rows, tabs, panes). These are pointer drags
  (`app/src/dnd/viewDrag.ts`), resolved by App's drop handler with the pure predicates in
  `dnd/noteRef.ts`.

Where the drag started does not change anything: dragging out of Finder while Finder is the
focused app, or while Bismuth is focused, arrives as the same native event.

## The matrix

| Draggable | Note (editor) | Chat tab | Daemon page |
|---|---|---|---|
| OS file — image (png/jpg/gif/webp) | copied into attachments + `![[embed]]` (or referenced, per `attachments.onDrop`) | attached to the message | attached to the message |
| OS file — HEIC/HEIF | copied + embedded | converted to JPEG, attached | converted to JPEG, attached |
| OS file — anything else (pdf, txt, zip, …) or folder | copied + embedded as a link | its absolute path in the draft | its absolute path in the draft |
| OS file dropped on a table cell | embedded into that cell | — | — |
| Browser image | downloaded (or pasteboard bytes) + embedded | pasteboard bytes attached; a remote-only image hands over its URL | same as chat tab |
| Link (URL) | inserted as a link | URL appended to the draft | URL appended to the draft |
| Text from another app | inserted at the drop point | appended to the draft | appended to the draft |
| Text selected in a note | moved within the note | appended to the draft | appended to the draft |
| Sidebar note (`.md`) | `[[wikilink]]` at the drop point | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Sidebar image / PDF | `![[embed]]` at the drop point | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Sidebar other file / folder | opens beside the note (split) | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Tab / pane | split, graft or replace (rearranging) | `[[mention]]` when it shows a vault file, else split | same as chat tab |

## Per surface

- **Notes** — `Editor.tsx`: the native listener (`handleNativeDrop`), the CodeMirror DOM drop
  handler, the table widget's cell drop, and App's `referenceOnPane` for sidebar rows.
- **Chat tab** and **daemon page** — both use `chat/createChatDropTarget.ts`, which normalises
  every outside draggable to a `ChatDropAction` (`chat/chatDrop.ts`) and hands it to
  `chatSessions.ts`'s `deliverChatDrop`. In-app draggables reach the same function from App's
  `referenceOnPane`, keyed by `noteRef.ts`'s `chatIdForContent` (a chat tab's id, or
  `DAEMON_CHAT_ID` for `::daemon`).
- **The daemon page** drops onto the whole page, not only the composer. Its chat has no session
  until armed (`daemon/daemonChatArming.ts`), and **a drop arms it**: a drop is a real user
  gesture app control cannot forge. The dropped item waits in `deliverChatDrop`'s queue until the
  session exists. A disabled daemon (`daemon.enabled: false`) accepts no drops.
- The drag-over cue on both chat surfaces is `ui/DropCue`.
