import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  GitBranch,
  GitCommitDetail,
  GitCommitNode,
  GitFileChange,
  GitOperation,
  GitRemote,
  ProjectModule,
  StashEntry,
} from "../ipc/protocol";
import { GitError, GitService } from "./GitService";
import { t } from "../i18n";
import { hasConflictMarkers, hasResultConflicts } from "./conflicts";
import { buildCommitGraph } from "./graph";
import { normalizeGitPatch, patchHasUnsafePaths } from "./patch";
import {
  parseBranches,
  parseLog,
  parseNameStatus,
  parsePorcelainV2,
  parseRefs,
  parseRemotes,
  parseStashList,
  type StatusParseResult,
} from "./parsers";

export interface RepoStatus extends StatusParseResult {
  operation: GitOperation;
}

export class GitRepository {
  constructor(readonly git: GitService) {}

  get root(): string | undefined {
    return this.git.repoRoot;
  }

  async init(root: string): Promise<void> {
    const created = await this.git.exec(["init", "-b", "main"], { cwd: root });
    if (created.code !== 0) {
      await this.git.execOk(["init"], { cwd: root });
    }
    this.git.repoRoot = root;
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.git.execOk(["remote", "add", name, url]);
  }

  async listRemotes(): Promise<GitRemote[]> {
    if (!this.git.repoRoot) {
      return [];
    }
    const result = await this.git.exec(["remote", "-v"], { silent: true });
    if (result.code !== 0) {
      return [];
    }
    return parseRemotes(result.stdout);
  }

  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.git.execOk(["remote", "set-url", name, url]);
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.execOk(["remote", "remove", name]);
  }

  async status(showIgnored = false): Promise<RepoStatus> {
    if (!this.git.repoRoot) {
      return { ahead: 0, behind: 0, files: [], operation: "none" };
    }
    const args = ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"];
    if (showIgnored) {
      args.push("--ignored=matching");
    }
    const result = await this.git.exec(args, { silent: true });
    const parsed = parsePorcelainV2(result.stdout);
    const operation = await this.git.getOperation();
    if (!parsed.branch) {
      parsed.branch = await this.git.currentBranch();
    }
    return { ...parsed, operation };
  }

  async listModules(): Promise<ProjectModule[]> {
    const root = this.git.repoRoot;
    if (!root) {
      return [];
    }
    const skip = new Set([".git", "node_modules", "target", "build", "dist", "out", ".idea", ".gradle", "vendor"]);
    const found: ProjectModule[] = [];
    const walk = async (rel: string, depth: number) => {
      if (depth > 8) {
        return;
      }
      const abs = rel ? path.join(root, rel) : root;
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      const names = new Set(entries.map((entry) => entry.name));
      if (names.has("pom.xml") || names.has("build.gradle") || names.has("build.gradle.kts")) {
        const posix = rel.replace(/\\/g, "/");
        found.push({
          path: posix,
          name: posix ? posix.slice(posix.lastIndexOf("/") + 1) : path.basename(root),
        });
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        await walk(next.replace(/\\/g, "/"), depth + 1);
      }
    };
    await walk("", 0);
    return found.sort((left, right) => left.path.localeCompare(right.path));
  }

  async log(options?: { branch?: string; search?: string; limit?: number; currentBranch?: string }): Promise<GitCommitNode[]> {
    if (!this.git.repoRoot) {
      return [];
    }
    const limit = options?.limit ?? 500;
    const args = [
      "log",
      "--topo-order",
      `--max-count=${limit}`,
      "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e",
    ];
    if (options?.branch) {
      args.push(options.branch);
    } else {
      args.push("HEAD");
    }
    if (options?.search) {
      const query = options.search.trim();
      if (/^[0-9a-f]{4,40}$/i.test(query)) {
        args.push(query);
      } else {
        args.push(`--grep=${query}`, "-i");
      }
    }
    const result = await this.git.exec(args, { silent: true });
    if (result.code !== 0) {
      return [];
    }
    const nodes = buildCommitGraph(parseLog(result.stdout));
    await this.markSharedWithCurrent(nodes, options?.branch, options?.currentBranch, limit);
    return nodes;
  }

  private async markSharedWithCurrent(
    nodes: GitCommitNode[],
    viewing?: string,
    current?: string,
    limit = 500,
  ): Promise<void> {
    if (!viewing || !current || viewing.includes("..")) {
      return;
    }
    const currentName = current === "DETACHED" ? "HEAD" : current;
    if (viewing === currentName || viewing === "HEAD") {
      return;
    }
    const listed = await this.git.exec(["rev-list", `--max-count=${Math.max(limit * 4, 2000)}`, currentName], {
      silent: true,
    });
    if (listed.code !== 0 || !listed.stdout.trim()) {
      return;
    }
    const onCurrent = new Set(listed.stdout.split(/\s+/).filter(Boolean));
    for (const node of nodes) {
      node.sharedWithCurrent = onCurrent.has(node.hash);
    }
  }

  async commitDetail(hash: string): Promise<GitCommitDetail | undefined> {
    if (!this.git.repoRoot) {
      return undefined;
    }
    const meta = await this.git.exec(
      ["show", "-s", "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b", hash],
      { silent: true },
    );
    if (meta.code !== 0) {
      return undefined;
    }
    const [fullHash, author, email, timestamp, subject, ...bodyParts] = meta.stdout.split("\x1f");
    const hashValue = fullHash?.trim() || hash;
    const [filesResult, decorate, contained, head] = await Promise.all([
      this.git.exec(["show", "--pretty=format:", "--name-status", "-z", "-M", hash], { silent: true }),
      this.git.exec(["log", "-1", "--decorate=short", "--pretty=%D", hash], { silent: true }),
      this.git.exec(["branch", "-a", "--contains", hash, "--format=%(refname:short)"], { silent: true }),
      this.git.exec(["rev-parse", "HEAD"], { silent: true }),
    ]);
    const refs = parseRefs(decorate.stdout.trim());
    const containedIn = sortContainedRefs(
      contained.stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter((item) => item && item !== "HEAD" && !item.endsWith("/HEAD")),
      head.stdout.trim() === hashValue,
    );
    return {
      hash: hashValue,
      subject: subject ?? "",
      body: (bodyParts.join("\x1f") ?? "").trim(),
      author: author ?? "",
      email: email ?? "",
      timestamp: Number(timestamp) || 0,
      files: parseNameStatus(filesResult.stdout),
      refs,
      containedIn,
    };
  }

  async branches(): Promise<GitBranch[]> {
    if (!this.git.repoRoot) {
      return [];
    }
    const current = await this.git.currentBranch();
    const result = await this.git.exec(
      ["for-each-ref", "--format=%(refname)%01%(refname:short)%01%(HEAD)%01%(upstream:short)", "refs/heads", "refs/remotes"],
      { silent: true },
    );
    if (result.code !== 0) {
      return [];
    }
    const list = parseBranches(result.stdout, current);
    const currentLocal = list.find((branch) => branch.current && !branch.remote);
    if (currentLocal) {
      const ab = await this.git.aheadBehind();
      currentLocal.ahead = ab.ahead;
      currentLocal.behind = ab.behind;
    }
    return list;
  }

  async commit(files: string[], message: string, amend = false): Promise<void> {
    const root = this.git.assertRepo();
    const relative = files.map((file) => this.git.resolveInRepo(file));
    if (!amend && !message.trim()) {
      throw new Error(t("error.commitMessage"));
    }
    if (relative.length) {
      await this.git.execOk(["add", "-A", "--", ...relative], { cwd: root });
    }
    const args = ["commit"];
    if (amend) {
      args.push("--amend", "--no-edit");
      if (message.trim()) {
        args.splice(2, 1, "-m", message);
      }
    } else {
      args.push("-m", message);
      if (relative.length) {
        args.push("--only", "--", ...relative);
      }
    }
    if (!relative.length && !amend) {
      throw new Error(t("select.noneCommit"));
    }
    await this.git.execOk(args, { cwd: root });
  }

  async track(files: string[]): Promise<void> {
    const root = this.git.assertRepo();
    const relative = files.map((file) => this.git.resolveInRepo(file));
    if (!relative.length) {
      throw new Error(t("select.noneTrack"));
    }
    await this.git.execOk(["add", "--", ...relative], { cwd: root });
  }

  async untrack(files: string[]): Promise<void> {
    const root = this.git.assertRepo();
    const relative = files.map((file) => this.git.resolveInRepo(file));
    if (!relative.length) {
      throw new Error(t("select.noneUntrack"));
    }
    const status = await this.status();
    for (const file of relative) {
      const entries = status.files.filter((item) => item.path === file);
      const tracked = entries.find((item) => item.status !== "untracked" && item.status !== "conflict");
      if (!tracked) {
        continue;
      }
      if (tracked.status === "added") {
        const restored = await this.git.exec(["restore", "--staged", "--", file], { cwd: root, silent: true });
        if (restored.code === 0) {
          continue;
        }
        const reset = await this.git.exec(["reset", "HEAD", "--", file], { cwd: root, silent: true });
        if (reset.code === 0) {
          continue;
        }
      }
      const removed = await this.git.exec(["rm", "--cached", "-f", "--", file], { cwd: root, silent: true });
      if (removed.code !== 0 && !/did not match|unknown revision/i.test(`${removed.stderr} ${removed.stdout}`)) {
        throw new GitError((removed.stderr || removed.stdout).trim() || t("error.untrackFailed"), removed, ["rm", "--cached", file]);
      }
    }
  }

  async rollback(files: string[]): Promise<void> {
    const root = this.git.assertRepo();
    const status = await this.status();
    const toRestore: string[] = [];
    const toDelete: string[] = [];
    for (const file of files) {
      const relative = this.git.resolveInRepo(file);
      const change = status.files.find((item) => item.path === relative);
      if (!change || change.status === "untracked" || change.status === "added") {
        toDelete.push(relative);
        if (change?.status === "added") {
          await this.git.exec(["restore", "--staged", "--", relative], { cwd: root, silent: true });
        }
        continue;
      }
      toRestore.push(relative);
    }
    if (toRestore.length) {
      await this.git.execOk(["restore", "--staged", "--worktree", "--", ...toRestore], { cwd: root });
    }
    for (const relative of toDelete) {
      const abs = path.join(root, relative);
      try {
        await fs.unlink(abs);
      } catch {
        await this.git.exec(["clean", "-fd", "--", relative], { cwd: root, silent: true });
      }
    }
  }

  async ignore(files: string[]): Promise<void> {
    const patterns = files.map((file) => this.git.resolveInRepo(file));
    await this.appendGitignore(patterns);
  }

  async ignoreFolders(files: string[]): Promise<{ message: string }> {
    const dirs = [...new Set(files.map((file) => this.parentDir(file)).filter((dir): dir is string => Boolean(dir)))];
    if (!dirs.length) {
      throw new Error(t("select.noneIgnoreFolder"));
    }
    await this.appendGitignore(dirs.map((dir) => `/${dir}/`));
    const root = this.git.assertRepo();
    for (const dir of dirs) {
      await this.git.exec(["rm", "-r", "--cached", "--", dir], { cwd: root, silent: true });
    }
    return { message: t("toast.ignoredFolder", { name: dirs.join(", ") }) };
  }

  private parentDir(file: string): string | undefined {
    const relative = this.git.resolveInRepo(file).replace(/\/+$/, "");
    const slash = relative.lastIndexOf("/");
    if (slash <= 0) {
      return undefined;
    }
    return relative.slice(0, slash);
  }

  private async appendGitignore(patterns: string[]): Promise<void> {
    const root = this.git.assertRepo();
    const gitignore = path.join(root, ".gitignore");
    let existing = "";
    try {
      existing = await fs.readFile(gitignore, "utf8");
    } catch {
      existing = "";
    }
    const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const additions = patterns.filter((pattern) => {
      const normalized = pattern.replace(/\\/g, "/");
      const variants = [normalized, normalized.replace(/^\//, ""), normalized.replace(/\/$/, ""), normalized.replace(/^\/|\/$/g, "")];
      return !variants.some((item) => lines.has(item));
    });
    if (!additions.length) {
      return;
    }
    const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
    await fs.appendFile(gitignore, `${prefix}${additions.join("\n")}\n`, "utf8");
  }

  async checkout(branch: string): Promise<void> {
    await this.git.execOk(["checkout", branch]);
  }

  async createBranch(name: string, startPoint?: string, checkout = true): Promise<void> {
    const args = checkout ? ["checkout", "-b", name] : ["branch", name];
    if (startPoint) {
      args.push(startPoint);
    }
    await this.git.execOk(args);
  }

  async deleteBranch(branch: string, remote: boolean): Promise<void> {
    if (remote) {
      const [remoteName, ...rest] = branch.split("/");
      await this.git.execOk(["push", remoteName, "--delete", rest.join("/")]);
      return;
    }
    await this.git.execOk(["branch", "-d", branch]);
  }

  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.git.execOk(["branch", "-m", oldName, newName]);
  }

  async merge(branch: string): Promise<GitOperationResult> {
    return this.runIntegrating(["merge", "--no-edit", branch]);
  }

  async rebase(branch: string): Promise<GitOperationResult> {
    return this.runIntegrating(["rebase", branch]);
  }

  async cherryPick(hash: string): Promise<GitOperationResult> {
    return this.runIntegrating(["cherry-pick", hash]);
  }

  async revert(hash: string): Promise<GitOperationResult> {
    return this.runIntegrating(["revert", "--no-edit", hash]);
  }

  async reset(hash: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
    await this.git.execOk(["reset", `--${mode}`, hash]);
  }

  async fetch(remote?: string): Promise<{ stdout: string; stderr: string }> {
    const args = remote ? ["fetch", "--prune", remote] : ["fetch", "--all", "--prune"];
    return this.git.execOk(args, { timeoutMs: 120_000 });
  }

  async pull(rebase: boolean, remote?: string, branch?: string): Promise<GitOperationResult> {
    const args = rebase ? ["pull", "--rebase", "--no-edit"] : ["pull", "--no-edit"];
    if (remote) {
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }
    return this.runIntegrating(args, 120_000);
  }

  async push(remote = "origin", branch?: string): Promise<{ stdout: string; stderr: string }> {
    const ref = branch?.trim() || "HEAD";
    const result = await this.git.exec(["push", "-u", remote, ref], { timeoutMs: 120_000 });
    if (result.code !== 0) {
      const retry = await this.git.exec(["push", remote, ref], { timeoutMs: 120_000 });
      if (retry.code !== 0) {
        throw new GitError((retry.stderr || retry.stdout).trim(), retry, ["push", remote, ref]);
      }
      return retry;
    }
    return result;
  }

  async outgoing(remote?: string, branch?: string): Promise<GitCommitNode[]> {
    if (!this.git.repoRoot) {
      return [];
    }
    const local = branch?.trim() || "HEAD";
    const range = remote && branch ? `${remote}/${branch}..${local}` : "@{u}..HEAD";
    const result = await this.git.exec(
      ["log", "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e", range],
      { silent: true },
    );
    if (result.code !== 0) {
      return [];
    }
    return buildCommitGraph(parseLog(result.stdout));
  }

  async continueOp(operation: GitOperation): Promise<void> {
    const leftover = await this.stageResolvedConflicts();
    if (leftover.length) {
      throw new Error(t("error.unmergedContinue", { files: leftover.join("\n") }));
    }
    switch (operation) {
      case "merge":
        await this.git.execOk(["commit", "--no-edit"]);
        break;
      case "rebase":
        await this.git.execOk(["rebase", "--continue"]);
        break;
      case "cherry-pick":
        await this.git.execOk(["cherry-pick", "--continue"]);
        break;
      case "revert":
        await this.git.execOk(["revert", "--continue"]);
        break;
      default:
        throw new Error(t("error.noOperation"));
    }
  }

  async stageResolvedConflicts(files?: string[]): Promise<string[]> {
    const status = await this.status(false);
    const wanted = files?.length
      ? new Set(files.map((file) => this.git.resolveInRepo(file).replace(/\\/g, "/")))
      : undefined;
    const conflicts = status.files.filter((file) => {
      if (file.status !== "conflict") {
        return false;
      }
      return !wanted || wanted.has(file.path.replace(/\\/g, "/"));
    });
    if (!conflicts.length) {
      return [];
    }
    const root = this.git.assertRepo();
    const leftover: string[] = [];
    const resolved: string[] = [];
    for (const file of conflicts) {
      const abs = path.join(root, file.path);
      let content = "";
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        leftover.push(file.path);
        continue;
      }
      if (content.includes("\0") || hasConflictMarkers(content) || hasResultConflicts(content)) {
        leftover.push(file.path);
        continue;
      }
      resolved.push(file.path);
    }
    if (resolved.length) {
      await this.git.execOk(["add", "--", ...resolved]);
    }
    return leftover;
  }

  async abortOp(operation: GitOperation): Promise<void> {
    switch (operation) {
      case "merge":
        await this.git.execOk(["merge", "--abort"]);
        break;
      case "rebase":
        await this.git.execOk(["rebase", "--abort"]);
        break;
      case "cherry-pick":
        await this.git.execOk(["cherry-pick", "--abort"]);
        break;
      case "revert":
        await this.git.execOk(["revert", "--abort"]);
        break;
      default:
        throw new Error(t("error.noOperation"));
    }
  }

  async acceptOurs(files: string[]): Promise<void> {
    const relative = files.map((file) => this.git.resolveInRepo(file));
    await this.git.execOk(["checkout", "--ours", "--", ...relative]);
    await this.git.execOk(["add", "--", ...relative]);
  }

  async acceptTheirs(files: string[]): Promise<void> {
    const relative = files.map((file) => this.git.resolveInRepo(file));
    await this.git.execOk(["checkout", "--theirs", "--", ...relative]);
    await this.git.execOk(["add", "--", ...relative]);
  }

  async stashPush(message?: string, files?: string[]): Promise<void> {
    const relative = (files ?? []).map((file) => this.git.resolveInRepo(file));
    if (files !== undefined && !relative.length) {
      throw new Error(t("select.noneStash"));
    }
    const root = this.git.assertRepo();
    const args = ["stash", "push"];
    if (message) {
      args.push("-m", message);
    }
    if (!relative.length) {
      await this.git.execOk(args, { cwd: root });
      return;
    }
    await this.stashSelected(root, args, relative);
  }

  /**
   * git stash push -- path 仍会把整个 index 写进 stash 快照。
   * 先把 index 收成只含选中文件，stash 后再把其余文件的暂存状态还原。
   */
  private async stashSelected(root: string, stashArgs: string[], relative: string[]): Promise<void> {
    const gitDir = await this.git.gitDir();
    const indexPath = path.join(gitDir, "index");
    const backupPath = path.join(gitDir, `index.easy-git-${process.pid}-${Date.now()}`);
    await fs.copyFile(indexPath, backupPath);
    let stashed = false;
    try {
      await this.git.execOk(["reset", "-q", "HEAD"], { cwd: root });
      await this.git.execOk(["add", "-A", "--", ...relative], { cwd: root });
      await this.git.execOk([...stashArgs, "--", ...relative], { cwd: root });
      stashed = true;
      await fs.copyFile(backupPath, indexPath);
      await this.git.exec(["restore", "--staged", "--", ...relative], { cwd: root, silent: true });
    } catch (error) {
      if (!stashed) {
        await fs.copyFile(backupPath, indexPath).catch(() => undefined);
      }
      throw error;
    } finally {
      await fs.unlink(backupPath).catch(() => undefined);
    }
  }

  async stashList(): Promise<StashEntry[]> {
    if (!this.git.repoRoot) {
      return [];
    }
    const result = await this.git.exec(["stash", "list", "--pretty=format:%gd%x1f%at%x1f%s"], { silent: true });
    if (result.code !== 0) {
      return [];
    }
    const list = parseStashList(result.stdout);
    await Promise.all(
      list.map(async (stash) => {
        stash.files = await this.stashFiles(stash.index);
      }),
    );
    return list;
  }

  async stashFiles(index: number): Promise<GitFileChange[]> {
    const spec = `stash@{${index}}`;
    const withUntracked = await this.git.exec(
      ["stash", "show", "--name-status", "-z", "--include-untracked", spec],
      { silent: true },
    );
    if (withUntracked.code === 0 && withUntracked.stdout.trim()) {
      return parseNameStatus(withUntracked.stdout);
    }
    const fallback = await this.git.exec(["stash", "show", "--name-status", "-z", spec], { silent: true });
    if (fallback.code !== 0 || !fallback.stdout.trim()) {
      return [];
    }
    return parseNameStatus(fallback.stdout);
  }

  async stashPop(index = 0): Promise<GitOperationResult> {
    return this.runIntegrating(["stash", "pop", `stash@{${index}}`]);
  }

  async stashApply(index = 0): Promise<GitOperationResult> {
    return this.runIntegrating(["stash", "apply", `stash@{${index}}`]);
  }

  async stashDrop(index = 0): Promise<void> {
    await this.git.execOk(["stash", "drop", `stash@{${index}}`]);
  }

  async diffPatch(files: string[]): Promise<string> {
    const root = this.git.assertRepo();
    const relative = files.map((file) => this.git.resolveInRepo(file));
    const tracked: string[] = [];
    const untracked: string[] = [];
    const status = await this.status();
    for (const file of relative) {
      const change = status.files.find((item) => item.path === file);
      if (!change || change.status === "untracked") {
        untracked.push(file);
      } else {
        tracked.push(file);
      }
    }
    let patch = "";
    if (tracked.length) {
      const staged = await this.git.exec(["diff", "--cached", "--", ...tracked], { cwd: root, silent: true });
      const unstaged = await this.git.exec(["diff", "--", ...tracked], { cwd: root, silent: true });
      patch += staged.stdout + unstaged.stdout;
    }
    for (const file of untracked) {
      const result = await this.git.exec(
        ["diff", "--no-index", "--binary", "--", "/dev/null", file],
        { cwd: root, silent: true },
      );
      patch += result.stdout;
    }
    const normalized = normalizeGitPatch(patch, root);
    if (patchHasUnsafePaths(normalized)) {
      throw new Error(t("error.shelfPatch"));
    }
    return normalized;
  }

  async applyPatch(patch: string): Promise<void> {
    const root = this.git.assertRepo();
    const normalized = normalizeGitPatch(patch, root);
    const result = await this.git.exec(["apply", "--whitespace=nowarn", "-"], { cwd: root, input: normalized });
    if (result.code === 0) {
      return;
    }
    const retry = await this.git.exec(["apply", "--ignore-whitespace", "-"], { cwd: root, input: normalized });
    if (retry.code !== 0) {
      const detail = (retry.stderr || retry.stdout || result.stderr).trim() || t("error.gitApply");
      throw new GitError(detail, retry, ["apply", "-"]);
    }
  }

  private async runIntegrating(args: string[], timeoutMs?: number): Promise<GitOperationResult> {
    const result = await this.git.exec(args, { timeoutMs });
    if (result.code === 0) {
      return { conflict: false, stdout: result.stdout, stderr: result.stderr };
    }
    const operation = await this.git.getOperation();
    const status = await this.status();
    const conflicts = status.files.filter((file) => file.status === "conflict");
    if (conflicts.length || operation !== "none") {
      return { conflict: true, files: conflicts, stdout: result.stdout, stderr: result.stderr };
    }
    throw new GitError((result.stderr || result.stdout).trim(), result, args);
  }
}

function sortContainedRefs(names: string[], includeHead: boolean): string[] {
  const unique = includeHead ? ["HEAD", ...names] : [...names];
  return [...new Set(unique)].sort((left, right) => {
    const rank = (name: string) => (name === "HEAD" ? 0 : name.includes("/") ? 2 : 1);
    const diff = rank(left) - rank(right);
    return diff !== 0 ? diff : left.localeCompare(right);
  });
}

export interface GitOperationResult {
  conflict: boolean;
  files?: GitFileChange[];
  stdout?: string;
  stderr?: string;
}
