import type { ChangeViewOptions, ProjectModule } from "@ipc";

export interface FileTreeNode {
  kind: "dir" | "mod";
  key: string;
  name: string;
  path: string;
  files: string[];
  children: FileTreeNode[];
}

export interface FileBucket {
  files: string[];
  children: FileTreeNode[];
}

export function collectNodeFiles(node: FileTreeNode): string[] {
  return [...node.files, ...node.children.flatMap(collectNodeFiles)];
}

export function groupChangeFiles(
  files: string[],
  view: ChangeViewOptions,
  modules: ProjectModule[],
): FileBucket {
  const usable = modules.filter((item) => item.path);
  if (view.groupModule && usable.length) {
    return groupByModule(files, view.groupDirectory, usable);
  }
  if (view.groupDirectory) {
    return splitDirs(files, "");
  }
  return { files, children: [] };
}

function groupByModule(files: string[], groupDirectory: boolean, modules: ProjectModule[]): FileBucket {
  const sorted = [...modules].sort((left, right) => right.path.length - left.path.length);
  const buckets = new Map<string, { mod: ProjectModule; files: string[] }>();
  const leftover: string[] = [];
  for (const file of files) {
    const mod = sorted.find((item) => belongsToModule(file, item.path));
    if (!mod) {
      leftover.push(file);
      continue;
    }
    const current = buckets.get(mod.path) ?? { mod, files: [] };
    current.files.push(file);
    buckets.set(mod.path, current);
  }
  const children: FileTreeNode[] = [...buckets.values()]
    .sort((left, right) => left.mod.name.localeCompare(right.mod.name, undefined, { sensitivity: "base" }))
    .map(({ mod, files: list }) => {
      const inner = groupDirectory ? splitDirs(list, mod.path) : { files: sortFiles(list), children: [] };
      return {
        kind: "mod" as const,
        key: `m:${mod.path}`,
        name: mod.name,
        path: mod.path,
        files: inner.files,
        children: inner.children,
      };
    });
  const rest = groupDirectory ? splitDirs(leftover, "") : { files: sortFiles(leftover), children: [] };
  return { files: rest.files, children: [...children, ...rest.children] };
}

function belongsToModule(file: string, modulePath: string): boolean {
  if (!modulePath) {
    return true;
  }
  return file === modulePath || file.startsWith(`${modulePath}/`);
}

function splitDirs(files: string[], base: string): FileBucket {
  const prefix = base ? `${base}/` : "";
  const direct: string[] = [];
  const nested = new Map<string, string[]>();
  for (const file of files) {
    if (base && file !== base && !file.startsWith(prefix)) {
      continue;
    }
    const rel = base ? file.slice(prefix.length) : file;
    if (!rel) {
      continue;
    }
    const cut = rel.indexOf("/");
    if (cut < 0) {
      direct.push(file);
      continue;
    }
    const segment = rel.slice(0, cut);
    const list = nested.get(segment) ?? [];
    list.push(file);
    nested.set(segment, list);
  }
  const children = [...nested.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: "base" }))
    .map(([name, list]) => {
      const path = `${prefix}${name}`;
      const inner = splitDirs(list, path);
      return compactDir({
        kind: "dir" as const,
        key: `d:${path}`,
        name,
        path,
        files: inner.files,
        children: inner.children,
      });
    });
  return { files: sortFiles(direct), children };
}

function compactDir(node: FileTreeNode): FileTreeNode {
  let current = node;
  while (current.files.length === 0 && current.children.length === 1 && current.children[0]?.kind === "dir") {
    const child = current.children[0];
    current = {
      kind: "dir",
      key: child.key,
      name: `${current.name}/${child.name}`,
      path: child.path,
      files: child.files,
      children: child.children,
    };
  }
  return current;
}

function sortFiles(files: string[]): string[] {
  return [...files].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}
