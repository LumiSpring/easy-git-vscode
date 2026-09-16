import * as vscode from "vscode";

const KEY = "easyGit.activeRemote";

export class RemoteStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): string | undefined {
    return this.context.workspaceState.get<string>(KEY);
  }

  async set(name: string): Promise<void> {
    await this.context.workspaceState.update(KEY, name);
  }

  async clear(): Promise<void> {
    await this.context.workspaceState.update(KEY, undefined);
  }

  resolve(names: string[]): string | undefined {
    if (!names.length) {
      return undefined;
    }
    const stored = this.get();
    if (stored && names.includes(stored)) {
      return stored;
    }
    if (names.includes("origin")) {
      return "origin";
    }
    return names[0];
  }
}
