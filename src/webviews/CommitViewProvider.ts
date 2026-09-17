import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../ipc/protocol";
import type { AppHost } from "../host/AppHost";
import { getWebviewHtml } from "./html";
import { t } from "../i18n";

export class CommitViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "easyGit.commit";
  private view?: vscode.WebviewView;
  private pendingBadge = 0;
  private badgeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host: AppHost,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri, "commit");
    webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.host.handleMessage("commit", message);
    });
    webviewView.onDidChangeVisibility(() => {
      this.applyBadge();
      if (!webviewView.visible) {
        webviewView.webview.postMessage({ type: "dismissUi" });
      }
    });
    webviewView.onDidDispose(() => {
      if (this.badgeTimer) {
        clearTimeout(this.badgeTimer);
        this.badgeTimer = undefined;
      }
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    this.applyBadge();
  }

  setBadge(count: number): void {
    this.pendingBadge = Math.max(0, Math.round(count));
    this.applyBadge();
  }

  private applyBadge(): void {
    if (!this.view) {
      return;
    }
    const next =
      this.pendingBadge > 0
        ? { value: this.pendingBadge, tooltip: t("tooltip.uncommitted", { count: this.pendingBadge }) }
        : undefined;
    // Cursor/VS Code often ignores a badge assignment that looks like a no-op.
    // Flip to 0 first so the activity-bar decoration is forced to re-render.
    this.view.badge = { value: 0, tooltip: next?.tooltip ?? "" };
    if (this.badgeTimer) {
      clearTimeout(this.badgeTimer);
    }
    this.badgeTimer = setTimeout(() => {
      if (this.view) {
        this.view.badge = next;
      }
    }, 0);
  }

  post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  reveal(): void {
    void vscode.commands.executeCommand("workbench.view.extension.easyGitCommit");
    void vscode.commands.executeCommand("easyGit.commit.focus");
    this.view?.show?.(true);
  }
}
