// The app-level modals: the Cmd+P/Cmd+O pair plus every dialog App opens from a command. At most
// ONE is open at a time — opening one replaces whatever was showing (App.tsx's `openModal`).
// Dialogs a modal opens on top of itself (a confirm inside a form) are not in this set; they
// stack through ui/Modal's own modalStack.
export type AppModal =
    | 'command'
    | 'template'
    | 'switcher'
    | 'folder'
    | 'daemon-owner'
    | 'daemon-setup'
    | 'bismuth-install'
    | 'edit-dictionary'
    | 'gcal-connect'

/** What is left open after `which` asks to close. Only the modal actually showing can close
 *  itself: the command palette runs a command and THEN calls its onClose, so when that command
 *  opened another modal, the palette's late close must not take the new one down with it. */
export const afterClose = (
    current: AppModal | null,
    which: AppModal,
): AppModal | null => (current === which ? null : current)

/** A keybinding toggles its own modal: closes it if showing, otherwise opens it in place of
 *  whatever else is. */
export const afterToggle = (
    current: AppModal | null,
    which: AppModal,
): AppModal | null => (current === which ? null : which)
