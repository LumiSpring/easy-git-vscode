import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ConsoleEntry, FileStatus, GitOperation } from "../ipc/protocol";
import { t } from "../i18n";

export interface GitExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly result: GitExecResult,
    readonly args: string[],
  ) {
    super(message);
  }
}

export class GitService {
  repoRoot: string | undefined;
  gitPath = "git";
  private consoleListener?: (entry: ConsoleEntry) => void;

  onConsole(listener: (entry: ConsoleEntry) => void): vscode.Disposable {
    this.consoleListener = listener;
    return new vscode.Disposable(() => {
      if (this.consoleListener === listener) {
        this.consoleListener = undefined;
      }
    });
  }

  async resolveGitPath(): Promise<string> {
    const configured = vscode.workspace.getConfiguration("easyGit").get<string>("gitPath", "git");
    this.gitPath = configured || "git";
    return this.gitPath;
  }

  async discoverRepo(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      this.repoRoot = undefined;
      return undefined;
    }
    for (const folder of folders) {
      const root = await this.findGitRoot(folder.uri.fsPath);
      if (root) {
        this.repoRoot = root;
        return root;
      }
    }
    this.repoRoot = undefined;
    return undefined;
  }

  private async findGitRoot(start: string): Promise<string | undefined> {
    let current = path.resolve(start);
    for (let i = 0; i < 12; i += 1) {
      try {
        const stat = await fs.stat(path.join(current, ".git"));
        if (stat.isDirectory() || stat.isFile()) {
          return current;
        }
      } catch {
        /* continue */
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    try {
      const result = await this.exec(["rev-parse", "--show-toplevel"], { cwd: start, silent: true });
      const root = result.stdout.trim();
      return root || undefined;
    } catch {
      return undefined;
    }
  }

  assertRepo(): string {
    if (!this.repoRoot) {
      throw new Error(t("error.noRepo"));
    }
    return this.repoRoot;
  }

  resolveInRepo(filePath: string): string {
    const root = this.assertRepo();
    const absolute = path.isAbsolute(filePath) ? path.normalize(filePath) : path.normalize(path.join(root, filePath));
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(t("error.pathOutside", { path: filePath }));
    }
    return relative.replace(/\\/g, "/");
  }

  async exec(
    args: string[],
    options?: { cwd?: string; input?: string; silent?: boolean; timeoutMs?: number },
  ): Promise<GitExecResult> {
    await this.resolveGitPath();
    const cwd = options?.cwd ?? this.repoRoot ?? process.cwd();
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const startedAt = Date.now();
    const result = await new Promise<GitExecResult>((resolve, reject) => {
      const run = (shell: boolean) => {
        const child = spawn(this.gitPath, args, {
          cwd,
          windowsHide: true,
          shell,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_OPTIONAL_LOCKS: "0",
            LANG: "C",
            LC_ALL: "C",
          },
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(t("error.gitTimeout", { args: args.join(" ") })));
        }, timeoutMs);
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr?.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          if (!shell && error.code === "ENOENT") {
            run(true);
            return;
          }
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? 1 });
        });
        if (options?.input) {
          child.stdin?.write(options.input);
        }
        child.stdin?.end();
      };
      run(false);
    });

    if (!options?.silent) {
      this.consoleListener?.({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command: `git ${args.join(" ")}`,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        startedAt,
        durationMs: Date.now() - startedAt,
      });
    }

    return result;
  }

  async execOk(args: string[], options?: { cwd?: string; input?: string; silent?: boolean; timeoutMs?: number }): Promise<GitExecResult> {
    const result = await this.exec(args, options);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`;
      throw new GitError(detail, result, args);
    }
    return result;
  }

  async getOperation(): Promise<GitOperation> {
    const root = this.repoRoot;
    if (!root) {
      return "none";
    }
    const gitDir = await this.gitDir();
    const checks: Array<[string, GitOperation]> = [
      ["MERGE_HEAD", "merge"],
      ["REBASE_HEAD", "rebase"],
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
    ];
    for (const [name, op] of checks) {
      try {
        await fs.stat(path.join(gitDir, name));
        return op;
      } catch {
        /* continue */
      }
    }
    return "none";
  }

  async gitDir(): Promise<string> {
    const root = this.assertRepo();
    const gitPath = path.join(root, ".git");
    try {
      const stat = await fs.stat(gitPath);
      if (stat.isDirectory()) {
        return gitPath;
      }
      const content = await fs.readFile(gitPath, "utf8");
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        const dir = match[1].trim();
        return path.isAbsolute(dir) ? dir : path.resolve(root, dir);
      }
    } catch {
      /* fall through */
    }
    return gitPath;
  }

  async currentBranch(): Promise<string | undefined> {
    if (!this.repoRoot) {
      return undefined;
    }
    const result = await this.exec(["rev-parse", "--abbrev-ref", "HEAD"], { silent: true });
    if (result.code !== 0) {
      return undefined;
    }
    const name = result.stdout.trim();
    return name === "HEAD" ? "DETACHED" : name;
  }

  async aheadBehind(): Promise<{ ahead: number; behind: number }> {
    if (!this.repoRoot) {
      return { ahead: 0, behind: 0 };
    }
    const result = await this.exec(["rev-list", "--left-right", "--count", "HEAD...@{u}"], { silent: true });
    if (result.code !== 0) {
      return { ahead: 0, behind: 0 };
    }
    const [ahead, behind] = result.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
    return { ahead, behind };
  }

  async showFile(ref: string, filePath: string): Promise<string> {
    const relative = this.resolveInRepo(filePath);
    if (ref === "EMPTY" || ref === "") {
      return "";
    }
    if (ref === "WORKTREE") {
      const abs = path.join(this.assertRepo(), relative);
      return fs.readFile(abs, "utf8");
    }
    const spec = ref === "INDEX" ? `:${relative}` : `${ref}:${relative}`;
    const result = await this.exec(["show", spec], { silent: true });
    if (result.code !== 0) {
      return "";
    }
    return result.stdout;
  }

  async showStage(stage: 1 | 2 | 3, filePath: string): Promise<string | undefined> {
    const relative = this.resolveInRepo(filePath);
    const result = await this.exec(["show", `:${stage}:${relative}`], { silent: true });
    if (result.code !== 0) {
      return undefined;
    }
    return result.stdout;
  }
}

export function mapXyToStatus(x: string, y: string): { status: FileStatus; staged: boolean } {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return { status: "conflict", staged: false };
  }
  const staged = x !== "." && x !== " " && x !== "?";
  // Index vs HEAD wins for new files: `AM` is still Added, not Modified.
  if (x === "A" && y !== "D") {
    return { status: "added", staged };
  }
  if (x === "R" || y === "R") {
    return { status: "renamed", staged };
  }
  if (x === "C" || y === "C") {
    return { status: "copied", staged };
  }
  if (x === "D" || y === "D") {
    return { status: "deleted", staged };
  }
  const letter = y !== "." && y !== " " ? y : x;
  switch (letter) {
    case "A":
      return { status: "added", staged };
    case "M":
    case "T":
      return { status: "modified", staged };
    default:
      return { status: "modified", staged };
  }
}
