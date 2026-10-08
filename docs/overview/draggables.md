# Draggables

A draggable is anything you can pick up and drop on Bismuth: a file, an image, a link, a run of text, a sidebar row, a tab or a pane. This page is the contract for which draggables each drop surface accepts and what each drop does. A new drop surface or a new kind of draggable updates the matrix below.

## What each drop does

The matrix lists every draggable against the three surfaces that accept all of them: a note, a chat tab and the daemon page.

| Draggable | Note (editor) | Chat tab | Daemon page |
|---|---|---|---|
| OS file: image (png, jpg, gif, webp) | copied into attachments + `![[embed]]` (or referenced, per `attachments.onDrop`) | attached to the message | attached to the message |
| OS file: HEIC or HEIF | copied + embedded | converted to JPEG, attached | converted to JPEG, attached |
| OS file: anything else (pdf, txt, zip) or a folder | copied + embedded as a link | its absolute path in the draft | its absolute path in the draft |
| OS file dropped on a table cell | embedded into that cell | not applicable | not applicable |
| Browser image | downloaded (or pasteboard bytes) + embedded | pasteboard bytes attached; a remote-only image hands over its URL | same as chat tab |
| Link (URL) | inserted as a link | URL appended to the draft | URL appended to the draft |
| Text from another app | inserted at the drop point | appended to the draft | appended to the draft |
| Text selected in a note | moved within the note | appended to the draft | appended to the draft |
| Sidebar note (`.md`) | `[[wikilink]]` at the drop point | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Sidebar image or PDF | `![[embed]]` at the drop point | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Sidebar other file or folder | opens beside the note (split) | `[[mention]]` + chat reference | `[[mention]]` + chat reference |
| Tab or pane | links or splits (see below) | `[[mention]]` when it shows a vault file, else split | same as chat tab |

The `attachments.onDrop` setting (`copy` by default, or `reference`) chooses whether a file from outside the vault is copied into the attachment folder or referenced in place; holding Option while dropping always references. See [settings reference](../settings/reference.md).

### Dropping a tab or pane on a note

A tab or pane that shows a note, image or PDF does the same thing as the sidebar row for that file. Dropping in the middle of the note pane (everything except the outer 10% band) inserts a `[[wikilink]]` for a note or an `![[embed]]` for an image or PDF. Dropping on the outer band splits the pane. Anything else, and a pane dropped on itself, rearranges: split, graft or replace.

### The two origins behave the same

Where a drag starts does not change what it does. Dragging out of Finder while Finder is focused, or while Bismuth is focused, arrives as the same event. Inside the app, a sidebar row, a tab and a split pane's header carrying the same file do the same thing on a note pane.

## Per surface

- **Notes** accept every row of the matrix, including a drop on a table cell.
- **A chat tab** and **the daemon page** share one drop target. The daemon page accepts a drop on the whole page, not only the composer.
- **The quick ask popover** (`Mod+K`, see [quick ask](../chat/overview.md#how-do-i-ask-a-quick-question)) accepts everything a chat tab does. It floats over a note, and a drop on the popover goes to its chat, never to the note underneath.
- **The daemon page** has no chat session until a person arms it, and a drop arms it: a drop is a real user gesture that app control cannot forge. The dropped item waits until the session exists. A disabled daemon (`daemon.enabled: false`) accepts no drops. See [daemon setup](../daemon/setup.md).
- **Terminal tabs** accept an OS or browser file drop: the file is uploaded into the attachment folder and its shell-quoted absolute path is typed at the prompt.
- **A Bases card** accepts an image file, which is uploaded and embedded in the card; see [Kanban](../bases/views/kanban.md).

## How it works

Every draggable arrives one of two ways, and a surface handles both.

- **From outside the app** (Finder, a browser, Photos, Messages, another editor). In the packaged app, Tauri's native drag-drop handler intercepts these and `app/src/nativeDrop.ts` re-broadcasts them as a `bismuth-native-drag` window event carrying real absolute paths and the cursor position.
- **From inside the app** (sidebar rows, tabs, panes). These are pointer drags (`app/src/dnd/viewDrag.ts`), resolved by `App.tsx`'s drop handler with the pure predicates in `app/src/dnd/noteRef.ts`.

The native event's `x` and `y` are in page CSS pixels. The bridge multiplies Tauri's raw coordinates once by a measured `nativeDragScale`, because the raw units differ per engine: WKWebView and WebKitGTK report logical points, WebView2 reports physical pixels. Consumers hit-test `x` and `y` as given and never re-correct. The [Tables](../editor/tables.md) page has the same coordinate note.

Each surface hit-tests the position against its own rect and claims the drop once (`claimNativeDrop` in `nativeDropRouting.ts`). This includes the sidebar file tree, so a drop another surface took is never also uploaded into the vault.

A drop with no paths (a browser image, a link, dragged text, a Photos or Messages file promise) is read off the OS drag pasteboard through the `read_drag_pasteboard` Tauri command and planned by `planDrop` in `dropIntake.ts`. In a browser (dev) build the same drags arrive as HTML5 `drop` events and go through the same planner via `pasteboardFromTransfer`.

One predicate, `editorReferencePath` in `noteRef.ts`, decides both the drop cue and the drop for a note pane, so the two never disagree. The 10% outer band is `REFERENCE_EDGE` in `app/src/dnd/geometry.ts`.

| Surface | Entry points |
|---|---|
| Note | `handleNativeDrop` and the CodeMirror DOM drop handler in `Editor.tsx`, the table widget's cell drop, and `referenceOnPane` in `App.tsx` for sidebar rows |
| Chat tab, daemon page | `chat/createChatDropTarget.ts` normalises every outside draggable to a `ChatDropAction` (`chat/chatDrop.ts`) and calls `deliverChatDrop` in `chatSessions.ts`; in-app draggables reach it from `referenceOnPane`, keyed by `chatIdForContent` (a chat tab's id, or `DAEMON_CHAT_ID` for `::daemon`) |
| Quick ask popover | the same `createChatDropTarget`, registered with `capture: true` so its native listener claims first; in-app draggables resolve to a `{ kind: 'chat' }` target off the panel's `data-chat-drop` attribute in `viewDrag.ts`, and `App.tsx` delivers a `mention` |
| Daemon arming | `daemon/daemonChatArming.ts` |
| Terminal | upload helpers in `Terminal.tsx` |
| Bases card | `bases/cardImageDrop.ts` |

The drag-over cue on every chat surface is `ui/DropCue`.

Source: `app/src/nativeDrop.ts`, `app/src/nativeDropRouting.ts`, `app/src/dropIntake.ts`, `app/src/dnd/viewDrag.ts`, `app/src/dnd/noteRef.ts`, `app/src/dnd/geometry.ts`, `app/src/chat/createChatDropTarget.ts`, `app/src/chat/chatDrop.ts`, `app/src/quickAsk/QuickAsk.tsx`, `app/src/daemon/daemonChatArming.ts`, `app/src-tauri/src/lib.rs`
