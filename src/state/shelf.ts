import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ShelfEntry } from "../ipc/protocol";

interface StoredShelf extends ShelfEntry {
  patch: string;
}

export class ShelfStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private dir(): string {
    return path.join(this.context.globalStorageUri.fsPath, "shelf");
  }

  private indexPath(): string {
    return path.join(this.dir(), "index.json");
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir(), { recursive: true });
  }

  async list(): Promise<ShelfEntry[]> {
    const all = await this.readAll();
    return all.map(({ patch: _patch, ...rest }) => rest);
  }

  async save(name: string, files: string[], patch: string): Promise<ShelfEntry> {
    await this.ensureDir();
    const entry: StoredShelf = {
      id: `shelf-${Date.now()}`,
      name,
      createdAt: Date.now(),
      files,
      patch,
    };
    const patchFile = path.join(this.dir(), `${entry.id}.patch`);
    await fs.writeFile(patchFile, patch, "utf8");
    const all = await this.readAll();
    all.unshift(entry);
    await fs.writeFile(this.indexPath(), JSON.stringify(all.map(stripPatchForIndex), null, 2), "utf8");
    return { id: entry.id, name: entry.name, createdAt: entry.createdAt, files: entry.files };
  }

  async getPatch(id: string): Promise<string> {
    const patchFile = path.join(this.dir(), `${id}.patch`);
    return fs.readFile(patchFile, "utf8");
  }

  async delete(id: string): Promise<void> {
    const all = (await this.readAll()).filter((item) => item.id !== id);
    await this.ensureDir();
    await fs.writeFile(this.indexPath(), JSON.stringify(all.map(stripPatchForIndex), null, 2), "utf8");
    try {
      await fs.unlink(path.join(this.dir(), `${id}.patch`));
    } catch {
      /* ignore */
    }
  }

  private async readAll(): Promise<StoredShelf[]> {
    try {
      const raw = await fs.readFile(this.indexPath(), "utf8");
      const index = JSON.parse(raw) as ShelfEntry[];
      const result: StoredShelf[] = [];
      for (const item of index) {
        let patch = "";
        try {
          patch = await fs.readFile(path.join(this.dir(), `${item.id}.patch`), "utf8");
        } catch {
          patch = "";
        }
        result.push({ ...item, patch });
      }
      return result;
    } catch {
      return [];
    }
  }
}

function stripPatchForIndex(entry: StoredShelf): ShelfEntry {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    files: entry.files,
  };
}
