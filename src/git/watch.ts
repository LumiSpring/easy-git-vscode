import * as vscode from "vscode";
import { GitService } from "./GitService";

export function watchGit(git: GitService, onChange: () => void): vscode.Disposable & { resync(): void } {
  const disposables: vscode.Disposable[] = [];
  let repoWatchers: vscode.Disposable[] = [];
  let timer: NodeJS.Timeout | undefined;
  let lastRoot: string | undefined;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (git.repoRoot !== lastRoot) {
        attachRepoWatchers();
      }
      onChange();
    }, 200);
  };

  const attachRepoWatchers = () => {
    for (const item of repoWatchers) {
      item.dispose();
    }
    repoWatchers = [];
    const root = git.repoRoot;
    lastRoot = root;
    const targets = root ? [root] : (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    for (const target of targets) {
      const pattern = root ? "**" : ".git/**";
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(target, pattern));
      watcher.onDidCreate(schedule);
      watcher.onDidChange(schedule);
      watcher.onDidDelete(schedule);
      repoWatchers.push(watcher);
      if (root) {
        const gitWatcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(root, ".git/{HEAD,index,COMMIT_EDITMSG,MERGE_HEAD,REBASE_HEAD,CHERRY_PICK_HEAD,refs/**}"),
        );
        gitWatcher.onDidCreate(schedule);
        gitWatcher.onDidChange(schedule);
        gitWatcher.onDidDelete(schedule);
        repoWatchers.push(gitWatcher);
      }
    }
  };

  disposables.push(vscode.workspace.onDidSaveTextDocument(schedule));
  disposables.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void git.discoverRepo().then(() => {
        attachRepoWatchers();
        onChange();
      });
    }),
  );
  attachRepoWatchers();

  const disposable = new vscode.Disposable(() => {
    if (timer) {
      clearTimeout(timer);
    }
    for (const item of [...disposables, ...repoWatchers]) {
      item.dispose();
    }
  });
  return Object.assign(disposable, {
    resync() {
      if (git.repoRoot !== lastRoot) {
        attachRepoWatchers();
      }
    },
  });
}
