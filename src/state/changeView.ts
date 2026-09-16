import * as vscode from "vscode";
import type { ChangeViewOptions } from "../ipc/protocol";

const COMMIT_KEY = "easyGit.changeView";

const DEFAULT_VIEW: ChangeViewOptions = {
  groupDirectory: true,
  groupModule: true,
  showIgnored: false,
};

export class ChangeViewStore {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly key = COMMIT_KEY,
  ) {}

  get(): ChangeViewOptions {
    const stored = this.context.workspaceState.get<Partial<ChangeViewOptions>>(this.key);
    return {
      groupDirectory: stored?.groupDirectory ?? DEFAULT_VIEW.groupDirectory,
      groupModule: stored?.groupModule ?? DEFAULT_VIEW.groupModule,
      showIgnored: stored?.showIgnored ?? DEFAULT_VIEW.showIgnored,
    };
  }

  async update(patch: Partial<ChangeViewOptions>): Promise<ChangeViewOptions> {
    const current = this.get();
    const next: ChangeViewOptions = {
      groupDirectory: patch.groupDirectory ?? current.groupDirectory,
      groupModule: patch.groupModule ?? current.groupModule,
      showIgnored: patch.showIgnored ?? current.showIgnored,
    };
    await this.context.workspaceState.update(this.key, next);
    return next;
  }
}
