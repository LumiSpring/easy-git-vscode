import type { ChangeViewOptions } from "@ipc";
import type { MenuItem } from "./ContextMenu";

export const DEFAULT_CHANGE_VIEW: ChangeViewOptions = {
  groupDirectory: true,
  groupModule: true,
  showIgnored: false,
};

export function changeViewMenu(view: ChangeViewOptions, options?: { ignored?: boolean }): MenuItem[] {
  const items: MenuItem[] = [
    { id: "group-by-header", label: "Group By", header: true },
    { id: "group-directory", label: "Directory", checked: view.groupDirectory, keepOpen: true },
    { id: "group-module", label: "Module", checked: view.groupModule, keepOpen: true },
  ];
  if (options?.ignored !== false) {
    items.push(
      { id: "show-sep", label: "", separator: true },
      { id: "show-header", label: "Show", header: true },
      { id: "show-ignored", label: "Ignored Files", checked: view.showIgnored, keepOpen: true },
    );
  }
  return items;
}
