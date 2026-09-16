import * as vscode from "vscode";
import type { ChangelistData, GitFileChange } from "../ipc/protocol";

const KEY = "easyGit.changelists";
export const DEFAULT_CHANGELIST_ID = "changes";
export const UNVERSIONED_ID = "unversioned";
export const CONFLICTS_ID = "conflicts";

interface StoredChangelist {
  id: string;
  name: string;
  active: boolean;
  files: string[];
}

export class ChangelistStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private read(): StoredChangelist[] {
    const stored = this.context.workspaceState.get<StoredChangelist[]>(KEY);
    if (stored?.length) {
      return stored;
    }
    return [{ id: DEFAULT_CHANGELIST_ID, name: "Changes", active: true, files: [] }];
  }

  private async write(lists: StoredChangelist[]): Promise<void> {
    await this.context.workspaceState.update(KEY, lists);
  }

  build(files: GitFileChange[]): ChangelistData[] {
    const lists = this.read();
    const trackedSet = new Set(
      files
        .filter((file) => file.status !== "untracked" && file.status !== "conflict" && file.status !== "ignored")
        .map((file) => file.path),
    );
    const unversionedSet = new Set(
      files.filter((file) => file.status === "untracked" || file.status === "ignored").map((file) => file.path),
    );
    const conflictSet = new Set(files.filter((file) => file.status === "conflict").map((file) => file.path));
    for (const list of lists) {
      list.files = list.files.filter((file) => trackedSet.has(file));
    }
    const assigned = new Set(lists.flatMap((list) => list.files));
    const active = lists.find((list) => list.active) ?? lists[0];
    for (const file of files) {
      if (file.status === "conflict" || file.status === "untracked" || file.status === "ignored") {
        continue;
      }
      if (!assigned.has(file.path) && active) {
        active.files.push(file.path);
        assigned.add(file.path);
      }
    }
    void this.write(lists);
    const result: ChangelistData[] = lists.map((list) => ({ ...list, files: [...list.files] }));
    if (conflictSet.size) {
      result.unshift({ id: CONFLICTS_ID, name: "Merge Conflicts", active: false, files: [...conflictSet] });
    }
    result.push({ id: UNVERSIONED_ID, name: "Unversioned Files", active: false, files: [...unversionedSet] });
    return result;
  }

  list(): Array<{ id: string; name: string; active: boolean }> {
    return this.read().map((list) => ({ id: list.id, name: list.name, active: list.active }));
  }

  async create(name: string, makeActive = false, files: string[] = []): Promise<ChangelistData> {
    const lists = this.read();
    if (files.length) {
      for (const list of lists) {
        list.files = list.files.filter((file) => !files.includes(file));
      }
    }
    const created: StoredChangelist = {
      id: `cl-${Date.now()}`,
      name,
      active: false,
      files: [...files],
    };
    if (makeActive) {
      for (const list of lists) {
        list.active = false;
      }
      created.active = true;
    }
    lists.push(created);
    await this.write(lists);
    return created;
  }

  async setActive(id: string): Promise<void> {
    if (id === UNVERSIONED_ID || id === CONFLICTS_ID) {
      return;
    }
    const lists = this.read();
    for (const list of lists) {
      list.active = list.id === id;
    }
    await this.write(lists);
  }

  async moveTo(files: string[], changelistId: string): Promise<void> {
    if (changelistId === UNVERSIONED_ID || changelistId === CONFLICTS_ID) {
      return;
    }
    const lists = this.read();
    for (const list of lists) {
      list.files = list.files.filter((file) => !files.includes(file));
    }
    const target = lists.find((list) => list.id === changelistId);
    if (!target) {
      return;
    }
    target.files.push(...files);
    await this.write(lists);
  }

  async removeFromAll(files: string[]): Promise<void> {
    const lists = this.read();
    for (const list of lists) {
      list.files = list.files.filter((file) => !files.includes(file));
    }
    await this.write(lists);
  }

  async delete(id: string): Promise<void> {
    if (id === DEFAULT_CHANGELIST_ID || id === UNVERSIONED_ID || id === CONFLICTS_ID) {
      return;
    }
    const lists = this.read().filter((list) => list.id !== id);
    if (!lists.some((list) => list.active) && lists[0]) {
      lists[0].active = true;
    }
    await this.write(lists);
  }

  async rename(id: string, name: string): Promise<void> {
    const lists = this.read();
    const target = lists.find((list) => list.id === id);
    if (target) {
      target.name = name;
      await this.write(lists);
    }
  }
}
