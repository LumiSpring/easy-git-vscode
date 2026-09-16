export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflict"
  | "ignored";

export type GitOperation = "none" | "merge" | "rebase" | "cherry-pick" | "revert";

export type UiLocale = "zh-cn" | "en";

export type ConflictSideKind = "modified" | "added" | "deleted";

export interface GitFileChange {
  path: string;
  oldPath?: string;
  status: FileStatus;
  staged: boolean;
  oursSide?: ConflictSideKind;
  theirsSide?: ConflictSideKind;
}

export interface ChangelistData {
  id: string;
  name: string;
  active: boolean;
  files: string[];
}

export interface GitBranch {
  name: string;
  fullName: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
  active: boolean;
}

export interface ProjectModule {
  path: string;
  name: string;
}

export interface ChangeViewOptions {
  groupDirectory: boolean;
  groupModule: boolean;
  showIgnored: boolean;
}

export interface GitCommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
  lane: number;
  laneCount: number;
  incoming: boolean;
  isMerge: boolean;
  isHead: boolean;
  sharedWithCurrent?: boolean;
  lines: GraphLine[];
}

export interface GraphLine {
  from: number;
  to: number;
  color: number;
  span: "full" | "down" | "in";
}

export interface GitCommitDetail {
  hash: string;
  subject: string;
  body: string;
  author: string;
  email: string;
  timestamp: number;
  files: GitFileChange[];
  refs: string[];
  containedIn: string[];
}

export interface StashEntry {
  index: number;
  name: string;
  subject: string;
  timestamp: number;
  files: GitFileChange[];
}

export interface ShelfEntry {
  id: string;
  name: string;
  createdAt: number;
  files: string[];
}

export interface ConsoleEntry {
  id: string;
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  code: number;
  startedAt: number;
  durationMs: number;
}

export interface CommitViewState {
  repoRoot?: string;
  workspaceFolder?: string;
  branch?: string;
  files: GitFileChange[];
  changelists: ChangelistData[];
  modules: ProjectModule[];
  changeView: ChangeViewOptions;
  conflictFiles: string[];
  operation: GitOperation;
  stashes: StashEntry[];
  shelves: ShelfEntry[];
  ahead: number;
  behind: number;
  language: UiLocale;
}

export interface LogViewState {
  repoRoot?: string;
  workspaceFolder?: string;
  currentBranch?: string;
  branches: GitBranch[];
  remotes: GitRemote[];
  commits: GitCommitNode[];
  selectedHash?: string;
  selectedCommit?: GitCommitDetail;
  console: ConsoleEntry[];
  filterBranch?: string;
  search: string;
  operation: GitOperation;
  modules: ProjectModule[];
  changeView: ChangeViewOptions;
  language: UiLocale;
}

export type MergeBlock =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "ours"; text: string; base: string }
  | { id: string; kind: "theirs"; text: string; base: string }
  | { id: string; kind: "conflict"; ours: string; theirs: string; base?: string };

export type MergeChoiceKind = "ours" | "theirs" | "both" | "manual";

export interface MergeChoice {
  id: string;
  choice: MergeChoiceKind;
  manual?: string;
}

export interface MergeViewState {
  path: string;
  oursLabel: string;
  theirsLabel: string;
  blocks: MergeBlock[];
}

export interface ApplyMergePayload {
  path: string;
  content: string;
}

export type HostToWebview =
  | { type: "commitState"; payload: CommitViewState }
  | { type: "logState"; payload: LogViewState }
  | { type: "mergeState"; payload: MergeViewState }
  | { type: "result"; id: string; ok: boolean; data?: unknown; error?: string }
  | { type: "dismissUi" };

export type WebviewToHost =
  | { type: "ready"; view: "commit" | "log" | "merge" }
  | { type: "refresh" }
  | { type: "selectCommit"; hash: string }
  | { type: "filterBranch"; branch?: string }
  | { type: "searchLog"; query: string }
  | { type: "request"; id: string; action: HostAction; payload?: unknown };

export type HostAction =
  | "commit"
  | "commitAndPush"
  | "amendCommit"
  | "rollback"
  | "showDiff"
  | "ignore"
  | "ignoreFolder"
  | "createChangelist"
  | "setActiveChangelist"
  | "moveToChangelist"
  | "deleteChangelist"
  | "renameChangelist"
  | "checkout"
  | "createBranch"
  | "deleteBranch"
  | "renameBranch"
  | "merge"
  | "rebase"
  | "cherryPick"
  | "revert"
  | "resetSoft"
  | "resetMixed"
  | "resetHard"
  | "copyRevision"
  | "fetch"
  | "pull"
  | "push"
  | "updateProject"
  | "continueOp"
  | "abortOp"
  | "acceptOurs"
  | "acceptTheirs"
  | "openMergeEditor"
  | "showConflicts"
  | "applyMerge"
  | "applyMergeSession"
  | "stashPush"
  | "stashPop"
  | "stashApply"
  | "stashDrop"
  | "shelve"
  | "unshelve"
  | "deleteShelf"
  | "showShelfDiff"
  | "newBranchFromCommit"
  | "compareWithCurrent"
  | "openLog"
  | "refresh"
  | "track"
  | "untrack"
  | "initRepository"
  | "addRemote"
  | "setRemoteUrl"
  | "removeRemote"
  | "openRemote"
  | "copyRemoteUrl"
  | "fetchRemote"
  | "setActiveRemote"
  | "setChangeView";

export interface CommitPayload {
  message: string;
  files: string[];
  amend?: boolean;
  push?: boolean;
}

export interface FilesPayload {
  files: string[];
}

export interface NamePayload {
  name: string;
}

export interface CreateBranchPayload {
  name?: string;
  startPoint?: string;
}

export interface BranchPayload {
  branch: string;
}

export interface RemotePayload {
  name: string;
  url?: string;
}

export interface HashPayload {
  hash: string;
}

export interface ChangelistCreatePayload {
  name?: string;
  files?: string[];
}

export interface ChangelistMovePayload {
  files: string[];
  changelistId?: string;
  name?: string;
  mode?: "move" | "add";
}

export interface DiffPayload {
  files: string[];
  hash?: string;
  status?: FileStatus;
}

export interface StashPayload {
  message?: string;
  files?: string[];
}

export interface ShelfPayload {
  name?: string;
  files: string[];
}

export interface ShelfIdPayload {
  id: string;
}

export interface ShelfDiffPayload {
  id: string;
  file: string;
}

export type ChangeViewPayload = Partial<ChangeViewOptions> & { scope?: "commit" | "log" };
