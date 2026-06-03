// app/src/icons/IconPicker.tsx
//
// A searchable grid of every Lucide icon. Used by the file tree's right-click
// "Set icon" on files (writes the `icon:` frontmatter) and folders (writes the
// folder-icon override).
//
// This is now a thin preset over the shared <SymbolGallery> (ui/gallery): the grid,
// search, capping, and "showing X of Y" hint all live there, driven by `iconSource`.
import { SymbolGallery } from "../ui/gallery/SymbolGallery";
import { iconSource } from "../ui/gallery/sources";

type Props = {
  /** Placeholder / heading for the search box. */
  title?: string;
  /** Currently-selected icon name, highlighted in the grid. */
  current?: string;
  onPick: (name: string) => void;
  /** When provided, shows a "Reset to default" action that clears the icon. */
  onClear?: () => void;
  onClose: () => void;
};

export function IconPicker(props: Props) {
  return (
    <SymbolGallery
      source={iconSource}
      title={props.title}
      current={props.current}
      onPick={props.onPick}
      onClear={props.onClear}
      clearLabel="RESET TO DEFAULT ICON"
      onClose={props.onClose}
    />
  );
}
