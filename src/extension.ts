import * as vscode from "vscode";
import { GitRevisionContentProvider } from "./git/contentProvider";
import { AppHost } from "./host/AppHost";
import { StatusBarController } from "./statusBar";
import { CommitViewProvider } from "./webviews/CommitViewProvider";
import { GitLogViewProvider } from "./webviews/GitLogViewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const host = new AppHost(context);
  const commitView = new CommitViewProvider(context.extensionUri, host);
  const logView = new GitLogViewProvider(context.extensionUri, host);
  const statusBar = new StatusBarController();
  host.commitView = commitView;
  host.logViews = [logView];
  host.statusBar = statusBar;

  const webviewOptions = { webviewOptions: { retainContextWhenHidden: true } };

  context.subscriptions.push(
    host,
    statusBar,
    vscode.workspace.registerTextDocumentContentProvider(GitRevisionContentProvider.scheme, new GitRevisionContentProvider(host.git)),
    vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, commitView, webviewOptions),
    vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewType, logView, webviewOptions),
    vscode.commands.registerCommand("easyGit.initRepository", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-init", action: "initRepository" }),
    ),
    vscode.commands.registerCommand("easyGit.refresh", () => host.refresh()),
    vscode.commands.registerCommand("easyGit.commit", () => commitView.reveal()),
    vscode.commands.registerCommand("easyGit.commitAndPush", () => commitView.reveal()),
    vscode.commands.registerCommand("easyGit.fetch", () => host.handleMessage("commit", { type: "request", id: "cmd-fetch", action: "fetch" })),
    vscode.commands.registerCommand("easyGit.pull", () => host.handleMessage("commit", { type: "request", id: "cmd-pull", action: "pull" })),
    vscode.commands.registerCommand("easyGit.push", () => host.handleMessage("commit", { type: "request", id: "cmd-push", action: "push" })),
    vscode.commands.registerCommand("easyGit.updateProject", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-update", action: "updateProject" }),
    ),
    vscode.commands.registerCommand("easyGit.showCommitView", () => commitView.reveal()),
    vscode.commands.registerCommand("easyGit.showLogView", () => host.revealLog()),
    vscode.commands.registerCommand("easyGit.showBranchMenu", () => host.showBranchMenu()),
    vscode.commands.registerCommand("easyGit.stash", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-stash", action: "stashPush", payload: {} }),
    ),
    vscode.commands.registerCommand("easyGit.stashPop", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-stash-pop", action: "stashPop", payload: { index: 0 } }),
    ),
    vscode.commands.registerCommand("easyGit.continue", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-continue", action: "continueOp" }),
    ),
    vscode.commands.registerCommand("easyGit.abort", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-abort", action: "abortOp" }),
    ),
    vscode.commands.registerCommand("easyGit.operationMenu", () => host.showOperationMenu()),
    vscode.commands.registerCommand("easyGit.showConflicts", () =>
      host.handleMessage("commit", { type: "request", id: "cmd-conflicts", action: "showConflicts" }),
    ),
  );

  await host.activate();
}

export function deactivate(): void {
  /* disposed via subscriptions */
}
