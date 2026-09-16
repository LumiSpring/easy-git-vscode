import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../ipc/protocol";
import type { AppHost } from "../host/AppHost";
import { getWebviewHtml } from "./html";

export class GitLogViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "easyGit.log";
  private view?: vscode.WebviewView;

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
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri, "log");
    webviewView.webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.host.handleMessage("log", message);
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.host.syncLog();
      } else {
        webviewView.webview.postMessage({ type: "dismissUi" });
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  reveal(): void {
    void vscode.commands.executeCommand("workbench.action.focusPanel");
    void vscode.commands.executeCommand("workbench.view.extension.easyGitLog");
    void vscode.commands.executeCommand("easyGit.log.focus");
    this.view?.show?.(true);
  }
}
