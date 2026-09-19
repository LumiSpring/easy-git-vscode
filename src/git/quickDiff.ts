import * as vscode from "vscode";
import { GitRevisionContentProvider } from "./contentProvider";
import type { GitService } from "./GitService";

/**
 * Registers a hidden SCM controller so VS Code can paint native gutter
 * decorations (added / modified / deleted) by diffing the editor against HEAD.
 */
export class EditorQuickDiff implements vscode.QuickDiffProvider, vscode.Disposable {
  private scm?: vscode.SourceControl;
  private lastRoot?: string;

  constructor(private readonly git: GitService) {}

  resync(): void {
    const root = this.git.repoRoot;
    if (root === this.lastRoot) {
      return;
    }
    this.scm?.dispose();
    this.scm = undefined;
    this.lastRoot = root;
    if (!root) {
      return;
    }
    const scm = vscode.scm.createSourceControl("easyGit", "Easy Git", vscode.Uri.file(root));
    scm.quickDiffProvider = this;
    scm.inputBox.visible = false;
    scm.inputBox.enabled = false;
    this.scm = scm;
  }

  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== "file" || !this.git.repoRoot) {
      return undefined;
    }
    let relative: string;
    try {
      relative = this.git.resolveInRepo(uri.fsPath);
    } catch {
      return undefined;
    }
    if (!relative || relative === ".git" || relative.startsWith(".git/")) {
      return undefined;
    }
    return GitRevisionContentProvider.uri("HEAD", relative, this.git.repoRoot);
  }

  dispose(): void {
    this.scm?.dispose();
    this.scm = undefined;
    this.lastRoot = undefined;
  }
}
