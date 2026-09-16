import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { GitRevisionContentProvider, StringContentProvider } from "../git/contentProvider";
import { detectEol, hasConflictMarkers, parseConflictFile, threeWayMerge, toGitConflictMarkers } from "../git/conflicts";
import { GitError, GitService } from "../git/GitService";
import { applyUnifiedDiff, extractFilePatch, patchFileIsDeleted, patchFileIsNew } from "../git/patch";
import { GitRepository } from "../git/repository";
import { watchGit } from "../git/watch";
import { getLocale, parseLocale, setLocale, t } from "../i18n";
import type {
  ApplyMergePayload,
  ChangeViewPayload,
  BranchPayload,
  ChangelistCreatePayload,
  ChangelistMovePayload,
  CommitPayload,
  CommitViewState,
  ConsoleEntry,
  CreateBranchPayload,
  DiffPayload,
  FilesPayload,
  FileStatus,
  HashPayload,
  HostAction,
  HostToWebview,
  LogViewState,
  MergeViewState,
  GitRemote,
  RemotePayload,
  ShelfDiffPayload,
  ShelfIdPayload,
  ShelfPayload,
  StashPayload,
  WebviewToHost,
} from "../ipc/protocol";
import { ChangeViewStore } from "../state/changeView";
import { ChangelistStore } from "../state/changelists";
import { RemoteStore } from "../state/remotes";
import { ShelfStore } from "../state/shelf";
import type { StatusBarController } from "../statusBar";
import { CommitViewProvider } from "../webviews/CommitViewProvider";
import { GitLogViewProvider } from "../webviews/GitLogViewProvider";
import { MergeEditor } from "../merge/MergeEditor";
import { ConflictsPanel } from "../webviews/ConflictsPanel";

export class AppHost implements vscode.Disposable {
  readonly git = new GitService();
  readonly repo = new GitRepository(this.git);
  readonly changelists: ChangelistStore;
  readonly shelves: ShelfStore;
  readonly remotes: RemoteStore;
  readonly changeView: ChangeViewStore;
  readonly logChangeView: ChangeViewStore;
  readonly virtualDocs = new StringContentProvider();
  commitView?: CommitViewProvider;
  logViews: GitLogViewProvider[] = [];
  statusBar?: StatusBarController;
  private readonly mergeEditor: MergeEditor;
  private readonly conflictsPanel: ConflictsPanel;
  private consoleEntries: ConsoleEntry[] = [];
  private selectedHash?: string;
  private filterBranch?: string;
  private search = "";
  private refreshing = false;
  private refreshQueued = false;
  private lastCommitState?: CommitViewState;
  private gitWatch?: vscode.Disposable & { resync(): void };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(readonly context: vscode.ExtensionContext) {
    this.changelists = new ChangelistStore(context);
    this.shelves = new ShelfStore(context);
    this.remotes = new RemoteStore(context);
    this.changeView = new ChangeViewStore(context);
    this.logChangeView = new ChangeViewStore(context, "easyGit.logChangeView");
    this.mergeEditor = new MergeEditor(this);
    this.conflictsPanel = new ConflictsPanel(this);
    this.syncLocale();
    this.disposables.push(
      this.mergeEditor,
      this.conflictsPanel,
      vscode.workspace.registerTextDocumentContentProvider(StringContentProvider.scheme, this.virtualDocs),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("easyGit.language")) {
          this.syncLocale();
          void this.refresh();
        }
      }),
      this.git.onConsole((entry) => {
        this.consoleEntries = [...this.consoleEntries, entry].slice(-200);
        void this.pushLogState();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.dismissUi()),
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) {
          this.dismissUi();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
          this.dismissUi();
        }
      }),
    );
  }

  async activate(): Promise<void> {
    await this.git.discoverRepo();
    this.gitWatch = watchGit(this.git, () => void this.refresh());
    this.disposables.push(this.gitWatch);
    await this.refresh();
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshQueued = false;
        await this.git.discoverRepo();
        this.gitWatch?.resync();
        await this.pushCommitState();
        await this.pushLogState();
        const status = this.lastCommitState;
        this.statusBar?.update(Boolean(this.git.repoRoot), status?.branch, status?.ahead, status?.behind, status?.operation ?? "none");
        await this.conflictsPanel.refresh();
      } while (this.refreshQueued);
    } finally {
      this.refreshing = false;
    }
  }

  async handleMessage(view: "commit" | "log", message: WebviewToHost): Promise<void> {
    if (message.type === "ready") {
      if (view === "commit") {
        await this.pushCommitState();
      } else {
        await this.pushLogState();
      }
      return;
    }
    if (message.type === "refresh") {
      await this.refresh();
      return;
    }
    if (message.type === "selectCommit") {
      this.selectedHash = message.hash;
      await this.pushLogState();
      return;
    }
    if (message.type === "filterBranch") {
      this.filterBranch = message.branch;
      await this.pushLogState();
      return;
    }
    if (message.type === "searchLog") {
      this.search = message.query;
      await this.pushLogState();
      return;
    }
    if (message.type === "request") {
      try {
        const data = await this.dispatch(message.action, message.payload);
        await this.refresh();
        this.reply(view, message.id, true, data);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!(error instanceof GitError && /conflict/i.test(text))) {
          void vscode.window.showErrorMessage(`Easy Git: ${text}`);
        }
        await this.refresh();
        this.reply(view, message.id, false, undefined, text);
      }
    }
  }

  private reply(view: "commit" | "log", id: string, ok: boolean, data?: unknown, error?: string): void {
    const message = { type: "result" as const, id, ok, data, error };
    if (view === "commit") {
      this.commitView?.post(message);
    } else {
      this.postLog(message);
    }
  }

  private async dispatch(action: HostAction, payload: unknown): Promise<unknown> {
    switch (action) {
      case "commit":
      case "commitAndPush":
      case "amendCommit":
        return this.handleCommit(action, payload as CommitPayload);
      case "rollback": {
        const files = (payload as FilesPayload).files;
        if (!files.length) {
          throw new Error(t("select.noneRollback"));
        }
        const confirm = await vscode.window.showWarningMessage(
          t("confirm.rollback", { count: files.length }),
          { modal: true },
          "Rollback",
        );
        if (confirm !== "Rollback") {
          return { silent: true };
        }
        await this.repo.rollback(files);
        return {
          message: files.length === 1 ? t("toast.rolledBackOne") : t("toast.rolledBackMany", { count: files.length }),
        };
      }
      case "showDiff": {
        const diff = payload as DiffPayload;
        await this.showDiff(diff.files[0], diff.hash, diff.status);
        return { silent: true };
      }
      case "ignore":
        await this.repo.ignore((payload as FilesPayload).files);
        return { silent: true };
      case "ignoreFolder":
        return this.repo.ignoreFolders((payload as FilesPayload).files);
      case "createChangelist":
        return this.createChangeGroup(payload as ChangelistCreatePayload | undefined);
      case "setActiveChangelist":
        return this.changelists.setActive((payload as { id: string }).id);
      case "moveToChangelist":
        return this.moveToChangeGroup(payload as ChangelistMovePayload);
      case "deleteChangelist":
        return this.changelists.delete((payload as { id: string }).id);
      case "renameChangelist":
        return this.renameChangeGroup((payload as { id: string; name?: string }).id, (payload as { name?: string }).name);
      case "checkout":
        return this.repo.checkout((payload as BranchPayload).branch);
      case "createBranch":
        return this.createGitBranch(payload as CreateBranchPayload | undefined);
      case "deleteBranch":
        return this.deleteBranch(payload as BranchPayload & { remote?: boolean });
      case "renameBranch":
        return this.renameGitBranch(payload as { oldName: string; name?: string });
      case "merge":
        return this.handleIntegrate(() => this.repo.merge((payload as BranchPayload).branch), "Merge completed");
      case "rebase":
        return this.handleIntegrate(() => this.repo.rebase((payload as BranchPayload).branch), "Rebase completed");
      case "cherryPick":
        return this.handleIntegrate(() => this.repo.cherryPick((payload as HashPayload).hash), "Cherry-pick completed");
      case "revert":
        return this.handleIntegrate(() => this.repo.revert((payload as HashPayload).hash), "Revert completed");
      case "resetSoft":
        return this.confirmReset((payload as HashPayload).hash, "soft");
      case "resetMixed":
        return this.confirmReset((payload as HashPayload).hash, "mixed");
      case "resetHard":
        return this.confirmReset((payload as HashPayload).hash, "hard");
      case "copyRevision":
        await vscode.env.clipboard.writeText((payload as HashPayload).hash);
        return { message: t("toast.copiedRevision") };
      case "fetch": {
        const result = await this.repo.fetch();
        return { message: this.summarizeGitOutput(result.stdout, result.stderr, t("toast.fetchDone")) };
      }
      case "pull": {
        const active = await this.requireActiveRemote();
        return this.handleIntegrate(
          () => this.repo.pull(vscode.workspace.getConfiguration("easyGit").get("pullRebase", false), active, this.currentBranchName()),
          "Pull completed",
        );
      }
      case "push":
        return this.pushWithPreview(false, (payload as BranchPayload | undefined)?.branch);
      case "updateProject": {
        const active = await this.requireActiveRemote();
        const fetched = await this.repo.fetch(active);
        const pulled = await this.handleIntegrate(
          () => this.repo.pull(vscode.workspace.getConfiguration("easyGit").get("pullRebase", false), active, this.currentBranchName()),
          "Update completed",
        );
        if (pulled.kind === "warning") {
          return pulled;
        }
        return {
          message: this.summarizeGitOutput(
            `${fetched.stdout}\n${pulled.stdout ?? ""}`,
            `${fetched.stderr}\n${pulled.stderr ?? ""}`,
            pulled.message,
          ),
        };
      }
      case "continueOp":
        await this.mergeEditor.applyIfReady();
        await this.repo.continueOp(this.lastCommitState?.operation ?? "none");
        return { message: t("toast.continued") };
      case "abortOp":
        await this.repo.abortOp(this.lastCommitState?.operation ?? "none");
        return { message: t("toast.aborted") };
      case "acceptOurs": {
        const files = (payload as FilesPayload).files;
        await this.repo.acceptOurs(files);
        await this.mergeEditor.dismissIfPaths(files);
        return {
          message: files.length === 1 ? t("toast.acceptOursOne") : t("toast.acceptOursMany", { count: files.length }),
        };
      }
      case "acceptTheirs": {
        const files = (payload as FilesPayload).files;
        await this.repo.acceptTheirs(files);
        await this.mergeEditor.dismissIfPaths(files);
        return {
          message: files.length === 1 ? t("toast.acceptTheirsOne") : t("toast.acceptTheirsMany", { count: files.length }),
        };
      }
      case "openMergeEditor":
        await this.openMergeEditor((payload as FilesPayload).files[0]);
        return { silent: true };
      case "showConflicts":
        await this.conflictsPanel.show();
        return { silent: true };
      case "applyMerge":
        await this.applyMergeResult(payload as ApplyMergePayload);
        return { message: t("toast.conflictsResolved") };
      case "applyMergeSession":
        return { message: await this.applyConflictFiles((payload as FilesPayload | undefined)?.files) };
      case "stashPush":
        return this.stashPush(payload as StashPayload | undefined);
      case "stashPop":
        return this.handleIntegrate(() => this.repo.stashPop((payload as { index?: number }).index ?? 0), "Stash popped");
      case "stashApply":
        return this.handleIntegrate(() => this.repo.stashApply((payload as { index?: number }).index ?? 0), "Stash applied");
      case "stashDrop":
        await this.repo.stashDrop((payload as { index?: number }).index ?? 0);
        return { message: t("toast.stashDropped") };
      case "shelve":
        return this.shelve(payload as ShelfPayload);
      case "unshelve":
        await this.unshelve((payload as ShelfIdPayload).id);
        return { message: t("toast.unshelved") };
      case "deleteShelf":
        await this.shelves.delete((payload as ShelfIdPayload).id);
        return { message: t("toast.shelfDeleted") };
      case "showShelfDiff":
        await this.showShelfDiff(payload as ShelfDiffPayload);
        return { silent: true };
      case "newBranchFromCommit":
        return this.createGitBranch({
          name: (payload as CreateBranchPayload).name,
          startPoint: (payload as HashPayload).hash,
        });
      case "compareWithCurrent": {
        const current = this.lastCommitState?.branch;
        const other = (payload as BranchPayload).branch;
        this.filterBranch = current ? `${current}..${other}` : other;
        this.revealLog();
        return undefined;
      }
      case "openLog":
        this.revealLog();
        return { silent: true };
      case "refresh":
        return { silent: true };
      case "track":
        await this.repo.track((payload as FilesPayload).files);
        return { message: t("toast.tracked") };
      case "untrack":
        await this.repo.untrack((payload as FilesPayload).files);
        await this.changelists.removeFromAll((payload as FilesPayload).files);
        return { message: t("toast.untracked") };
      case "initRepository":
        return this.initRepository();
      case "addRemote":
        return this.addGitRemote(payload as RemotePayload | undefined);
      case "setRemoteUrl":
        return this.editGitRemote(payload as RemotePayload);
      case "removeRemote":
        return this.removeGitRemote((payload as RemotePayload).name);
      case "openRemote":
        return this.openGitRemote((payload as RemotePayload).name);
      case "copyRemoteUrl":
        return this.copyGitRemoteUrl((payload as RemotePayload).name);
      case "fetchRemote": {
        const result = await this.repo.fetch((payload as RemotePayload).name);
        return { message: this.summarizeGitOutput(result.stdout, result.stderr, t("toast.fetchDone")) };
      }
      case "setActiveRemote":
        return this.setActiveRemote((payload as RemotePayload).name);
      case "setChangeView": {
        const view = payload as ChangeViewPayload;
        const { scope, ...patch } = view;
        if (scope === "log") {
          await this.logChangeView.update(patch);
        } else {
          await this.changeView.update(patch);
        }
        return { silent: true };
      }
      default:
        throw new Error(t("error.unknownAction", { action }));
    }
  }

  private async handleCommit(action: HostAction, payload: CommitPayload): Promise<{ message: string; silent?: boolean }> {
    let text = payload.message?.trim() ?? "";
    const amend = Boolean(payload.amend || action === "amendCommit");
    if (!text && !amend) {
      text =
        (
          await vscode.window.showInputBox({
            prompt: t("prompt.commitMessage"),
            placeHolder: t("prompt.commitPlaceholder"),
          })
        )?.trim() ?? "";
      if (!text) {
        return { message: "", silent: true };
      }
    }
    await this.repo.commit(payload.files, text, amend);
    if (action === "commitAndPush" || payload.push) {
      await this.pushWithPreview(true);
      return { message: t("toast.committedPushed") };
    }
    return { message: amend ? t("toast.amendDone") : t("toast.commitDone") };
  }

  private async createChangeGroup(payload?: ChangelistCreatePayload): Promise<{ message: string; silent?: boolean }> {
    const name =
      payload?.name?.trim() ||
      (await vscode.window.showInputBox({
        prompt: t("prompt.newChangeGroup"),
        placeHolder: t("prompt.changeGroupPlaceholder"),
      }));
    if (!name?.trim()) {
      return { message: "", silent: true };
    }
    const files = payload?.files?.filter(Boolean) ?? [];
    if (files.length) {
      await this.trackIfUntracked(files);
    }
    await this.changelists.create(name.trim(), true, files);
    if (files.length) {
      return { message: t("toast.groupCreatedFiles", { name: name.trim(), count: files.length }) };
    }
    return { message: t("toast.groupCreated", { name: name.trim() }) };
  }

  private async renameChangeGroup(id: string, given?: string): Promise<{ message: string; silent?: boolean }> {
    const current = this.changelists.list().find((list) => list.id === id);
    const name =
      given?.trim() ||
      (await vscode.window.showInputBox({
        prompt: t("prompt.changeGroupName"),
        value: current?.name,
      }));
    if (!name?.trim()) {
      return { message: "", silent: true };
    }
    await this.changelists.rename(id, name.trim());
    return { message: t("toast.groupRenamed", { name: name.trim() }) };
  }

  private async trackIfUntracked(files: string[]): Promise<void> {
    const untracked = files.filter((file) =>
      this.lastCommitState?.files.some((item) => item.path === file && item.status === "untracked"),
    );
    if (untracked.length) {
      await this.repo.track(untracked);
    }
  }

  private async moveToChangeGroup(payload: ChangelistMovePayload): Promise<{ message: string; silent?: boolean }> {
    if (!payload.files.length) {
      throw new Error(t("select.noneMove"));
    }
    let id = payload.changelistId;
    let name = payload.name?.trim();
    if (!id && !name) {
      const groups = this.changelists
        .list()
        .filter((list) => list.id !== "unversioned" && list.id !== "conflicts");
      const add = payload.mode === "add";
      const picked = await vscode.window.showQuickPick(
        [
          { label: "$(add) New ChangeGroup…", id: "__new__" },
          ...groups.map((list) => ({
            label: list.name,
            description: list.active ? "active" : undefined,
            id: list.id,
          })),
        ],
        { title: add ? "Add to ChangeGroup" : "Move to ChangeGroup" },
      );
      if (!picked) {
        return { message: "", silent: true };
      }
      if (picked.id === "__new__") {
        name =
          (await vscode.window.showInputBox({
            prompt: t("prompt.newChangeGroup"),
            placeHolder: t("prompt.changeGroupPlaceholder"),
          })) ?? undefined;
        if (!name?.trim()) {
          return { message: "", silent: true };
        }
      } else {
        id = picked.id;
      }
    }
    if (!id && name) {
      const created = await this.changelists.create(name.trim(), false);
      id = created.id;
    }
    if (!id) {
      return { message: "", silent: true };
    }
    await this.trackIfUntracked(payload.files);
    await this.changelists.moveTo(payload.files, id);
    const target = this.changelists.list().find((list) => list.id === id);
    const verb = payload.mode === "add" ? "Added to" : "Moved to";
    return { message: `${verb} ${target?.name ?? "ChangeGroup"}` };
  }

  private async createGitBranch(payload?: CreateBranchPayload): Promise<{ message: string; silent?: boolean }> {
    const startPoint = payload?.startPoint?.trim();
    const name =
      payload?.name?.trim() ||
      (await vscode.window.showInputBox({
        prompt: startPoint ? t("prompt.newBranchFrom", { start: startPoint }) : t("prompt.newBranch"),
        placeHolder: t("prompt.branchPlaceholder"),
      }));
    if (!name?.trim()) {
      return { message: "", silent: true };
    }
    await this.repo.createBranch(name.trim(), startPoint);
    return { message: t("toast.branchCreated", { name: name.trim() }) };
  }

  async initRepository(): Promise<{ message: string; silent?: boolean }> {
    if (this.git.repoRoot) {
      throw new Error(t("error.alreadyRepo"));
    }
    const root = await this.pickWorkspaceFolder();
    if (!root) {
      return { message: "", silent: true };
    }
    await this.repo.init(root);
    await this.git.discoverRepo();
    this.gitWatch?.resync();
    const remote = await vscode.window.showInputBox({
      prompt: t("prompt.remoteUrlOptional"),
      placeHolder: "https://github.com/org/repo.git",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return;
        }
        return isGitRemoteUrl(value) ? undefined : t("validate.remoteUrl");
      },
    });
    if (remote === undefined) {
      return { message: t("toast.gitInited") };
    }
    const url = remote.trim();
    if (!url) {
      return { message: t("toast.gitInited") };
    }
    await this.repo.addRemote("origin", url);
    await this.remotes.set("origin");
    return { message: t("toast.gitInitedOrigin") };
  }

  private async pickWorkspaceFolder(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      throw new Error(t("error.openFolder"));
    }
    if (folders.length === 1) {
      return folders[0].uri.fsPath;
    }
    const picked = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      { title: t("prompt.initFolder") },
    );
    return picked?.folder.uri.fsPath;
  }

  private async addGitRemote(payload?: RemotePayload): Promise<{ message: string; silent?: boolean }> {
    const remotes = await this.repo.listRemotes();
    const name =
      payload?.name?.trim() ||
      (await vscode.window.showInputBox({
        prompt: t("prompt.remoteName"),
        value: remotes.some((item) => item.name === "origin") ? "" : "origin",
        placeHolder: "origin",
      }));
    if (!name?.trim()) {
      return { message: "", silent: true };
    }
    if (remotes.some((item) => item.name === name.trim())) {
      throw new Error(t("error.remoteExists", { name: name.trim() }));
    }
    const url = payload?.url?.trim() || (await this.askRemoteUrl(t("prompt.remoteUrl")));
    if (!url) {
      return { message: "", silent: true };
    }
    await this.repo.addRemote(name.trim(), url);
    const listed = await this.repo.listRemotes();
    if (listed.length === 1) {
      await this.remotes.set(name.trim());
    }
    return { message: t("toast.remoteAdded", { name: name.trim() }) };
  }

  private async editGitRemote(payload: RemotePayload): Promise<{ message: string; silent?: boolean }> {
    const remotes = await this.repo.listRemotes();
    const current = remotes.find((item) => item.name === payload.name);
    if (!current) {
      throw new Error(t("error.remoteMissing", { name: payload.name }));
    }
    const url = payload.url?.trim() || (await this.askRemoteUrl(t("prompt.editRemote", { name: payload.name }), current.fetchUrl));
    if (!url) {
      return { message: "", silent: true };
    }
    await this.repo.setRemoteUrl(payload.name, url);
    return { message: t("toast.remoteUpdated", { name: payload.name }) };
  }

  private async removeGitRemote(name: string): Promise<{ message: string; silent?: boolean }> {
    const confirm = await vscode.window.showWarningMessage(t("confirm.deleteRemote", { name }), { modal: true }, "Delete");
    if (confirm !== "Delete") {
      return { message: "", silent: true };
    }
    const wasActive = this.remotes.get() === name;
    await this.repo.removeRemote(name);
    if (wasActive) {
      const listed = await this.repo.listRemotes();
      const next = this.remotes.resolve(listed.map((item) => item.name));
      if (next) {
        await this.remotes.set(next);
      } else {
        await this.remotes.clear();
      }
    }
    return { message: t("toast.remoteDeleted", { name }) };
  }

  private async openGitRemote(name: string): Promise<{ message: string; silent?: boolean }> {
    const remotes = await this.repo.listRemotes();
    const current = remotes.find((item) => item.name === name);
    if (!current) {
      throw new Error(t("error.remoteMissing", { name }));
    }
    const browse = toRemoteBrowseUrl(current.fetchUrl);
    if (!browse) {
      throw new Error(t("error.cannotOpenUrl", { url: current.fetchUrl }));
    }
    await vscode.env.openExternal(vscode.Uri.parse(browse));
    return { message: "", silent: true };
  }

  private async copyGitRemoteUrl(name: string): Promise<{ message: string }> {
    const remotes = await this.repo.listRemotes();
    const current = remotes.find((item) => item.name === name);
    if (!current) {
      throw new Error(t("error.remoteMissing", { name }));
    }
    await vscode.env.clipboard.writeText(current.fetchUrl);
    return { message: t("toast.remoteCopied") };
  }

  private async setActiveRemote(name: string): Promise<{ message: string }> {
    const remotes = await this.repo.listRemotes();
    if (!remotes.some((item) => item.name === name)) {
      throw new Error(t("error.remoteMissing", { name }));
    }
    await this.remotes.set(name);
    return { message: t("toast.remoteActive", { name }) };
  }

  private async requireActiveRemote(): Promise<string> {
    const remotes = await this.repo.listRemotes();
    const name = this.remotes.resolve(remotes.map((item) => item.name));
    if (!name) {
      throw new Error(t("error.addRemoteFirst"));
    }
    return name;
  }

  private currentBranchName(): string | undefined {
    const branch = this.lastCommitState?.branch?.trim();
    if (!branch || branch === "DETACHED" || branch === "HEAD") {
      return undefined;
    }
    return branch;
  }

  private markActiveRemotes(remotes: GitRemote[]): GitRemote[] {
    const active = this.remotes.resolve(remotes.map((item) => item.name));
    return remotes.map((item) => ({ ...item, active: item.name === active }));
  }

  private async askRemoteUrl(prompt: string, value?: string): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
      prompt,
      value,
      placeHolder: "https://github.com/org/repo.git",
      ignoreFocusOut: true,
      validateInput: (input) => {
        if (!input.trim()) {
          return t("prompt.remoteRequired");
        }
        return isGitRemoteUrl(input) ? undefined : t("validate.remoteUrl");
      },
    });
    return result?.trim();
  }

  private async stashPush(payload?: StashPayload): Promise<{ message: string; silent?: boolean }> {
    if (payload?.files !== undefined && payload.files.length === 0) {
      throw new Error(t("select.noneStash"));
    }
    const message =
      payload?.message !== undefined
        ? payload.message
        : await vscode.window.showInputBox({
            prompt: t("prompt.stashMessage"),
            placeHolder: "WIP",
          });
    if (message === undefined) {
      return { message: "", silent: true };
    }
    await this.repo.stashPush(message.trim() || undefined, payload?.files);
    return { message: t("toast.stashed") };
  }

  private async renameGitBranch(payload: { oldName: string; name?: string }): Promise<{ message: string; silent?: boolean }> {
    const name =
      payload.name?.trim() ||
      (await vscode.window.showInputBox({
        prompt: t("prompt.newBranch"),
        value: payload.oldName,
      }));
    if (!name?.trim() || name.trim() === payload.oldName) {
      return { message: "", silent: true };
    }
    await this.repo.renameBranch(payload.oldName, name.trim());
    return { message: t("toast.branchRenamed", { name: name.trim() }) };
  }

  private async deleteBranch(payload: BranchPayload & { remote?: boolean }): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      t("confirm.deleteBranch", { branch: payload.branch }),
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }
    await this.repo.deleteBranch(payload.branch, Boolean(payload.remote));
  }

  private async confirmReset(hash: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
    if (mode === "hard") {
      const confirm = await vscode.window.showWarningMessage(
        t("confirm.resetHard", { hash: hash.slice(0, 7) }),
        { modal: true },
        "Reset",
      );
      if (confirm !== "Reset") {
        return;
      }
    }
    await this.repo.reset(hash, mode);
  }

  private async handleIntegrate(
    run: () => Promise<{ conflict: boolean; stdout?: string; stderr?: string }>,
    fallback: string,
  ): Promise<{ message: string; kind?: "warning"; stdout?: string; stderr?: string }> {
    const result = await run();
    if (result.conflict) {
      this.commitView?.reveal();
      await this.conflictsPanel.show();
      return { message: t("toast.conflict"), kind: "warning", stdout: result.stdout, stderr: result.stderr };
    }
    return {
      message: this.summarizeGitOutput(result.stdout ?? "", result.stderr ?? "", fallback),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  private summarizeGitOutput(stdout: string, stderr: string, fallback: string): string {
    const text = `${stdout}\n${stderr}`;
    const hasUpdate =
      /\[new branch\]/i.test(text) ||
      /\[new tag\]/i.test(text) ||
      /[0-9a-f]{6,}\.\.[0-9a-f]{6,}/i.test(text) ||
      /Fast-forward/i.test(text) ||
      /^Updating /m.test(text) ||
      /^To /m.test(text);
    if (/already up.to.date/i.test(text) || /everything up-to-date/i.test(text)) {
      return hasUpdate ? fallback : t("toast.upToDate");
    }
    if (!text.trim() || !hasUpdate) {
      return t("toast.upToDate");
    }
    return fallback;
  }

  private async pushWithPreview(skipPreview = false, branchName?: string): Promise<{ message: string; silent?: boolean }> {
    const remote = await this.requireActiveRemote();
    const branch = branchName?.trim() || this.currentBranchName();
    if (!skipPreview) {
      const outgoing = await this.repo.outgoing(remote, branch);
      const picks = outgoing.slice(0, 20).map((commit) => `${commit.shortHash}  ${commit.subject}`);
      const target = branch ? `${remote}/${branch}` : remote;
      const summary = picks.length
        ? t("push.previewCommits", {
            target,
            count: outgoing.length,
            list: `${picks.join("\n")}${outgoing.length > 20 ? "\n…" : ""}`,
          })
        : t("push.previewEmpty", { target });
      const confirm = await vscode.window.showInformationMessage(summary, { modal: true }, "Push");
      if (confirm !== "Push") {
        return { message: "", silent: true };
      }
    }
    const result = await this.repo.push(remote, branch);
    return { message: this.summarizeGitOutput(result.stdout, result.stderr, t("toast.pushed", { branch: branch ?? "HEAD", remote })) };
  }

  async showDiff(filePath?: string, hash?: string, status?: FileStatus): Promise<void> {
    if (!filePath || !this.git.repoRoot) {
      return;
    }
    const relative = this.git.resolveInRepo(filePath);
    const abs = vscode.Uri.file(path.join(this.git.repoRoot, relative));
    if (hash) {
      const added = status === "added" || status === "untracked";
      const deleted = status === "deleted";
      const leftRef = added ? "EMPTY" : `${hash}^`;
      let rightRef = deleted ? "EMPTY" : hash;
      if (hash.startsWith("stash@{") && added) {
        const content = await this.git.showFile(hash, relative);
        if (!content) {
          rightRef = `${hash}^3`;
        }
      }
      const left = GitRevisionContentProvider.uri(leftRef, relative, this.git.repoRoot);
      const right = GitRevisionContentProvider.uri(rightRef, relative, this.git.repoRoot);
      const label = hash.startsWith("stash@{") ? hash : hash.slice(0, 7);
      await vscode.commands.executeCommand("vscode.diff", left, right, `${relative} (${label})`);
      return;
    }
    const fileStatus = status ?? this.lastCommitState?.files.find((file) => file.path === relative)?.status;
    const leftRef = fileStatus === "untracked" || fileStatus === "added" ? "EMPTY" : "HEAD";
    const left = GitRevisionContentProvider.uri(leftRef, relative, this.git.repoRoot);
    const right = fileStatus === "deleted" ? GitRevisionContentProvider.uri("EMPTY", relative, this.git.repoRoot) : abs;
    await vscode.commands.executeCommand("vscode.diff", left, right, `${relative} (Working Tree)`);
  }

  async openConflictMerge(filePath?: string): Promise<void> {
    await this.openMergeEditor(filePath);
  }

  async incomingConflictLabel(): Promise<string> {
    return this.mergeIncomingLabel();
  }

  private async openMergeEditor(filePath?: string): Promise<void> {
    if (!filePath || !this.git.repoRoot) {
      return;
    }
    await this.mergeEditor.open(filePath);
  }

  async loadMergeState(filePath: string): Promise<MergeViewState | undefined> {
    if (!this.git.repoRoot) {
      return undefined;
    }
    const relative = this.git.resolveInRepo(filePath);
    const abs = path.join(this.git.repoRoot, relative);
    let content = "";
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      content = "";
    }
    if (content.includes("\0")) {
      void vscode.window.showWarningMessage(t("error.binaryAccept", { path: relative }));
      return undefined;
    }
    content = toGitConflictMarkers(content);
    const ours = await this.git.showStage(2, relative);
    const theirs = await this.git.showStage(3, relative);
    const base = await this.git.showStage(1, relative);
    let blocks: MergeViewState["blocks"] = hasConflictMarkers(content) ? parseConflictFile(content) : [];
    if (!blocks.some((block) => block.kind === "conflict") && ours !== undefined && theirs !== undefined) {
      blocks = threeWayMerge(base ?? "", ours, theirs);
    }
    if (!blocks.some((block) => block.kind === "conflict")) {
      if (ours === undefined && theirs === undefined) {
        await vscode.window.showTextDocument(vscode.Uri.file(abs));
        return undefined;
      }
      blocks = [{ id: "c0", kind: "conflict", ours: ours ?? "", theirs: theirs ?? "", base: base ?? "" }];
    }
    return {
      path: relative,
      oursLabel: (await this.git.currentBranch()) ?? "HEAD",
      theirsLabel: await this.mergeIncomingLabel(),
      blocks,
    };
  }

  async applyConflictFiles(files?: string[]): Promise<string> {
    const requested = (files ?? []).map((file) => this.git.resolveInRepo(file)).filter(Boolean);
    const sessionPath = this.mergeEditor.currentRelative();
    const sessionWanted = Boolean(
      sessionPath &&
        (!requested.length || requested.some((file) => file.replace(/\\/g, "/") === sessionPath.replace(/\\/g, "/"))),
    );
    if (sessionWanted) {
      await this.mergeEditor.applyIfReady();
    }
    const leftover = await this.repo.stageResolvedConflicts(requested.length ? requested : undefined);
    await this.refresh();
    if (leftover.length) {
      throw new Error(t("error.unresolvedApply", { files: leftover.join(", ") }));
    }
    if (requested.length === 1) {
      return t("toast.appliedOne");
    }
    if (requested.length > 1) {
      return t("toast.appliedMany", { count: requested.length });
    }
    return t("toast.stagedResolved");
  }

  async acceptConflictOurs(files: string[]): Promise<void> {
    await this.repo.acceptOurs(files);
    await this.mergeEditor.dismissIfPaths(files);
  }

  async acceptConflictTheirs(files: string[]): Promise<void> {
    await this.repo.acceptTheirs(files);
    await this.mergeEditor.dismissIfPaths(files);
  }

  async applyMergeResult(payload: ApplyMergePayload): Promise<void> {
    if (!payload.path || !this.git.repoRoot) {
      throw new Error(t("error.noMergeResult"));
    }
    const relative = this.git.resolveInRepo(payload.path);
    const abs = path.join(this.git.repoRoot, relative);
    const merged = payload.content ?? "";
    if (hasConflictMarkers(merged)) {
      throw new Error(t("error.mergeMarkers"));
    }
    let original = "";
    try {
      original = await fs.readFile(abs, "utf8");
    } catch {
      original = "";
    }
    const eol = detectEol(original);
    const body = eol === "\r\n" ? merged.replace(/\n/g, "\r\n") : merged;
    await fs.writeFile(abs, body, "utf8");
    await this.git.execOk(["add", "--", relative]);
    await this.mergeEditor.dismissIfPaths([relative]);
    await this.refresh();
  }

  private async mergeIncomingLabel(): Promise<string> {
    const operation = await this.git.getOperation();
    const refs: Partial<Record<typeof operation, string>> = {
      merge: "MERGE_HEAD",
      rebase: "REBASE_HEAD",
      "cherry-pick": "CHERRY_PICK_HEAD",
      revert: "REVERT_HEAD",
    };
    const ref = refs[operation];
    if (!ref) {
      return "Incoming";
    }
    const named = await this.git.exec(["name-rev", "--name-only", "--no-undefined", ref], { silent: true });
    const name = named.stdout.trim().replace(/^remotes\//, "");
    if (named.code === 0 && name && name !== "undefined") {
      return name;
    }
    return "Incoming";
  }

  private async shelve(payload: ShelfPayload): Promise<{ message: string; silent?: boolean }> {
    if (!payload.files.length) {
      throw new Error(t("select.noneShelve"));
    }
    const name =
      payload.name?.trim() ||
      (await vscode.window.showInputBox({
        prompt: t("prompt.shelfName"),
        value: "Shelf",
      }));
    if (!name?.trim()) {
      return { message: "", silent: true };
    }
    const patch = await this.repo.diffPatch(payload.files);
    if (!patch.trim()) {
      throw new Error(t("error.noShelveChanges"));
    }
    await this.shelves.save(name.trim(), payload.files, patch);
    await this.repo.rollback(payload.files);
    return { message: t("toast.shelved") };
  }

  private async showShelfDiff(payload: ShelfDiffPayload): Promise<void> {
    if (!payload.file || !this.git.repoRoot) {
      return;
    }
    const relative = this.git.resolveInRepo(payload.file);
    const patch = await this.shelves.getPatch(payload.id);
    const filePatch = extractFilePatch(patch, relative);
    if (!filePatch) {
      throw new Error(t("error.shelfMissingFile", { path: relative }));
    }
    const isNew = patchFileIsNew(filePatch);
    const isDeleted = patchFileIsDeleted(filePatch);
    const leftText = isNew ? "" : await this.git.showFile("HEAD", relative);
    let rightText = "";
    if (!isDeleted) {
      try {
        rightText = applyUnifiedDiff(leftText, filePatch);
      } catch (error) {
        rightText = error instanceof Error ? `${filePatch}\n\n# ${error.message}` : filePatch;
      }
    }
    const left = this.virtualDocs.put(`shelf-${payload.id}-left-${relative}`, leftText, `before/${relative}`);
    const right = this.virtualDocs.put(`shelf-${payload.id}-right-${relative}`, rightText, `after/${relative}`);
    const shelf = (await this.shelves.list()).find((item) => item.id === payload.id);
    const when = shelf ? formatShelfTime(shelf.createdAt) : "";
    const label = shelf ? `${shelf.name}${when ? ` ${when}` : ""}` : "Shelf";
    await vscode.commands.executeCommand("vscode.diff", left, right, `${relative} (${label})`);
  }

  private async unshelve(id: string): Promise<void> {
    const patch = await this.shelves.getPatch(id);
    await this.repo.applyPatch(patch);
  }

  async showBranchMenu(): Promise<void> {
    const branches = await this.repo.branches();
    const items: vscode.QuickPickItem[] = [
      { label: "$(plus) New Branch…", alwaysShow: true },
      { label: "$(sync) Fetch", alwaysShow: true },
      { label: "$(arrow-down) Update Project", alwaysShow: true },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "Local", kind: vscode.QuickPickItemKind.Separator },
      ...branches
        .filter((branch) => !branch.remote)
        .map((branch) => ({
          label: `${branch.current ? "$(check) " : ""}${branch.name}`,
          description: branch.ahead || branch.behind ? `↑${branch.ahead} ↓${branch.behind}` : branch.upstream,
          detail: "local",
        })),
      { label: "Remote", kind: vscode.QuickPickItemKind.Separator },
      ...branches
        .filter((branch) => branch.remote)
        .map((branch) => ({
          label: branch.name,
          description: "remote",
          detail: "remote",
        })),
    ];
    const picked = await vscode.window.showQuickPick(items, { title: "Git Branches" });
    if (!picked || picked.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }
    if (picked.label.includes("New Branch")) {
      const name = await vscode.window.showInputBox({ prompt: t("prompt.newBranch") });
      if (name) {
        await this.repo.createBranch(name);
        await this.refresh();
      }
      return;
    }
    if (picked.label.includes("Fetch")) {
      await this.repo.fetch();
      await this.refresh();
      return;
    }
    if (picked.label.includes("Update Project")) {
      await this.dispatch("updateProject", {});
      await this.refresh();
      return;
    }
    const name = picked.label.replace("$(check) ", "");
    const isRemote = picked.detail === "remote";
    const action = await vscode.window.showQuickPick(
      [
        { label: "Checkout" },
        { label: "Merge into Current" },
        { label: "Rebase Current onto This" },
        { label: "Compare with Current" },
        { label: "Rename…" },
        { label: "Delete…" },
      ],
      { title: name },
    );
    if (!action) {
      return;
    }
    if (action.label === "Checkout") {
      await this.repo.checkout(name);
    } else if (action.label === "Merge into Current") {
      await this.handleIntegrate(() => this.repo.merge(name), "Merge completed");
    } else if (action.label === "Rebase Current onto This") {
      await this.handleIntegrate(() => this.repo.rebase(name), "Rebase completed");
    } else if (action.label === "Compare with Current") {
      const current = this.lastCommitState?.branch;
      this.filterBranch = current ? `${current}..${name}` : name;
      this.revealLog();
    } else if (action.label === "Rename…") {
      const next = await vscode.window.showInputBox({ prompt: t("prompt.rename"), value: name });
      if (next) {
        await this.repo.renameBranch(name, next);
      }
    } else if (action.label === "Delete…") {
      await this.deleteBranch({ branch: name, remote: isRemote });
    }
    await this.refresh();
  }

  async showOperationMenu(): Promise<void> {
    const operation = this.lastCommitState?.operation ?? "none";
    if (operation === "none") {
      void vscode.window.showInformationMessage(t("error.noOperation"));
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [
        { label: "Continue", description: t("op.continueDesc", { op: operation }) },
        { label: "Abort", description: t("op.abortDesc", { op: operation }) },
      ],
      { title: `Git ${operation}` },
    );
    if (picked?.label === "Continue") {
      await this.handleMessage("commit", { type: "request", id: "op-continue", action: "continueOp" });
    } else if (picked?.label === "Abort") {
      await this.handleMessage("commit", { type: "request", id: "op-abort", action: "abortOp" });
    }
  }

  private syncLocale(): void {
    setLocale(parseLocale(vscode.workspace.getConfiguration("easyGit").get("language")));
  }

  private async pushCommitState(): Promise<void> {
    const view = this.changeView.get();
    const status = await this.repo.status(view.showIgnored);
    const [stashes, shelves, modules] = await Promise.all([
      this.repo.stashList(),
      this.shelves.list(),
      this.repo.listModules(),
    ]);
    const state: CommitViewState = {
      repoRoot: this.git.repoRoot,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      branch: status.branch,
      files: status.files,
      changelists: this.changelists.build(status.files),
      modules,
      changeView: view,
      conflictFiles: status.files.filter((file) => file.status === "conflict").map((file) => file.path),
      operation: status.operation,
      stashes,
      shelves,
      ahead: status.ahead,
      behind: status.behind,
      language: getLocale(),
    };
    this.lastCommitState = state;
    this.commitView?.post({ type: "commitState", payload: state });
    this.commitView?.setBadge(status.files.length);
  }

  private async pushLogState(): Promise<void> {
    if (!this.lastCommitState) {
      await this.pushCommitState();
    }
    const status = this.lastCommitState;
    if (!status) {
      return;
    }
    const limit = vscode.workspace.getConfiguration("easyGit").get<number>("logLimit", 500);
    if (!this.filterBranch) {
      this.filterBranch = this.defaultLogBranch(status);
    }
    const [branches, commits, listed] = await Promise.all([
      this.repo.branches(),
      this.repo.log({
        branch: this.filterBranch,
        search: this.search,
        limit,
        currentBranch: status.branch,
      }),
      this.repo.listRemotes(),
    ]);
    if (this.selectedHash && !commits.some((commit) => commit.hash === this.selectedHash)) {
      this.selectedHash = commits[0]?.hash;
    }
    if (!this.selectedHash) {
      this.selectedHash = commits[0]?.hash;
    }
    const selectedCommit = this.selectedHash ? await this.repo.commitDetail(this.selectedHash) : undefined;
    const state: LogViewState = {
      repoRoot: this.git.repoRoot,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      currentBranch: status.branch,
      branches,
      remotes: this.markActiveRemotes(listed),
      commits,
      selectedHash: this.selectedHash,
      selectedCommit,
      console: this.consoleEntries,
      filterBranch: this.filterBranch,
      search: this.search,
      operation: status.operation,
      modules: status.modules,
      changeView: this.logChangeView.get(),
      language: getLocale(),
    };
    this.postLog({ type: "logState", payload: state });
  }

  private defaultLogBranch(status?: CommitViewState): string {
    const current = status?.branch?.trim();
    if (!current || current === "DETACHED") {
      return "HEAD";
    }
    return current;
  }

  async syncLog(): Promise<void> {
    await this.pushLogState();
  }

  revealLog(): void {
    this.logViews[0]?.reveal();
  }

  dismissUi(): void {
    const message = { type: "dismissUi" as const };
    this.commitView?.post(message);
    this.postLog(message);
  }

  private postLog(message: HostToWebview): void {
    for (const view of this.logViews) {
      view.post(message);
    }
  }
}

function formatShelfTime(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isGitRemoteUrl(value: string): boolean {
  const url = value.trim();
  if (!url || /\s/.test(url)) {
    return false;
  }
  if (/^(https?|git|ssh):\/\//i.test(url)) {
    return true;
  }
  return /^[\w.-]+@[\w.-]+:.+/i.test(url);
}

function toRemoteBrowseUrl(url: string): string | undefined {
  let value = url.trim().replace(/\.git$/i, "");
  const scp = value.match(/^git@([^:]+):(.+)$/i);
  if (scp) {
    return `https://${scp[1]}/${scp[2]}`;
  }
  const ssh = value.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/i);
  if (ssh) {
    return `https://${ssh[1]}/${ssh[2]}`;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return undefined;
}
