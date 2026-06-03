// app/src/FolderPrompt.tsx
// Minimal modal to type an absolute folder path for the "Open folder" command. We
// avoid window.prompt (a blocking native dialog freezes in-app automation), and the
// browser can't offer a real folder picker that yields a server-accessible path. The
// native OS picker is a desktop-build enhancement; the typed path works everywhere.
import { createSignal, onMount } from "solid-js";
import { Modal } from "./ui/Modal";
import { TextButton } from "./ui/TextButton";
import "./FolderPrompt.css";

export function FolderPrompt(props: { onClose: () => void; onOpen: (folder: string) => void }) {
  const [value, setValue] = createSignal("");
  let inputRef: HTMLInputElement | undefined;
  onMount(() => inputRef?.focus());

  const submit = () => {
    const v = value().trim();
    if (v) props.onOpen(v);
  };

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Open folder</div>
      <div class="folder-prompt-hint">
        Absolute path to a folder. It opens as its own brain in a new window.
      </div>
      <input
        ref={inputRef}
        class="folder-prompt-input"
        placeholder="/Users/you/notes"
        value={value()}
        spellcheck={false}
        autocapitalize="off"
        autocorrect="off"
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div class="folder-prompt-actions">
        <TextButton onClick={props.onClose}>CANCEL</TextButton>
        <TextButton variant="selected" onClick={submit} disabled={value().trim() === ""}>
          OPEN
        </TextButton>
      </div>
    </Modal>
  );
}
