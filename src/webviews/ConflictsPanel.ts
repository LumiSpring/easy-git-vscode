import * as path from "node:path";
import * as vscode from "vscode";
import type { AppHost } from "../host/AppHost";
import type { ConflictSideKind, GitFileChange, GitOperation } from "../ipc/protocol";
import { t } from "../i18n";
import { nonce } from "./html";

interface ConflictRow {
  path: string;
  name: string;
  directory: string;
  ours: string;
  theirs: string;
}

interface ConflictDialogState {
  heading: string;
  oursBranch: string;
  theirsBranch: string;
  files: ConflictRow[];
}

export class ConflictsPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private selected = new Set<string>();

  constructor(private readonly host: AppHost) {}

  dispose(): void {
    this.panel?.dispose();
  }

  get visible(): boolean {
    return Boolean(this.panel);
  }

  async show(): Promise<void> {
    const state = await this.loadState();
    if (!state.files.length) {
      void vscode.window.showInformationMessage(t("toast.noConflicts"));
      this.panel?.dispose();
      return;
    }
    await this.render(state, true);
  }

  async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const state = await this.loadState();
    if (!state.files.length) {
      this.panel.dispose();
      void vscode.window.showInformationMessage(t("toast.allConflictsDone"));
      return;
    }
    await this.render(state, false);
  }

  private async render(state: ConflictDialogState, reveal: boolean): Promise<void> {
    const available = new Set(state.files.map((file) => file.path));
    this.selected = new Set([...this.selected].filter((item) => available.has(item)));
    if (!this.selected.size && state.files[0]) {
      this.selected.add(state.files[0].path);
    }
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("easyGit.conflicts", "Conflicts", vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      this.panel.webview.onDidReceiveMessage((message: { type?: string; path?: string; paths?: string[] }) => {
        void this.onMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.selected.clear();
      });
    }
    this.panel.webview.html = this.html(this.panel.webview, state);
    if (reveal) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
    }
  }

  private async onMessage(message: { type?: string; path?: string; paths?: string[] }): Promise<void> {
    const files = uniquePaths(message.paths ?? (message.path ? [message.path] : [...this.selected]));
    if (message.type === "select") {
      this.selected = new Set(files);
      return;
    }
    if (message.type === "close") {
      this.panel?.dispose();
      return;
    }
    if (!files.length) {
      return;
    }
    this.selected = new Set(files);
    try {
      if (message.type === "acceptOurs") {
        await this.host.acceptConflictOurs(files);
        await this.host.refresh();
        return;
      }
      if (message.type === "acceptTheirs") {
        await this.host.acceptConflictTheirs(files);
        await this.host.refresh();
        return;
      }
      if (message.type === "apply") {
        const result = await this.host.applyConflictFiles(files);
        await this.host.refresh();
        void vscode.window.showInformationMessage(result);
        return;
      }
      if (message.type === "merge") {
        await this.host.openConflictMerge(files[0]);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Easy Git: ${text}`);
    }
  }

  private async loadState(): Promise<ConflictDialogState> {
    const status = await this.host.repo.status(false);
    const oursBranch = status.branch ?? "HEAD";
    const theirsBranch = await this.host.incomingConflictLabel();
    return {
      heading: conflictHeading(status.operation, oursBranch, theirsBranch),
      oursBranch,
      theirsBranch,
      files: status.files.filter((file) => file.status === "conflict").map((file) => toRow(file)),
    };
  }

  private html(webview: vscode.Webview, state: ConflictDialogState): string {
    const n = nonce();
    const selected = [...this.selected];
    const rows = state.files
      .map((file) => {
        const active = this.selected.has(file.path) ? " selected" : "";
        return `<tr class="row${active}" data-path="${escapeHtml(file.path)}" tabindex="0">
  <td class="name">
    <span class="icon">📄</span>
    <span class="file">${escapeHtml(file.name)}</span>
    <span class="dir">${escapeHtml(file.directory)}</span>
  </td>
  <td>${escapeHtml(file.ours)}</td>
  <td>${escapeHtml(file.theirs)}</td>
</tr>`;
      })
      .join("");
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
  <style>
    :root {
      --bg: var(--vscode-editor-background, #3c3f41);
      --fg: var(--vscode-foreground, #bbbbbb);
      --muted: var(--vscode-descriptionForeground, #808080);
      --border: var(--vscode-panel-border, #515151);
      --header: var(--vscode-sideBarSectionHeader-background, #4b4f52);
      --row: var(--vscode-list-hoverBackground, #4b4f52);
      --sel: var(--vscode-list-activeSelectionBackground, #2f65ca);
      --selfg: var(--vscode-list-activeSelectionForeground, #fff);
      --btn: var(--vscode-button-secondaryBackground, #4c5052);
      --btnfg: var(--vscode-button-secondaryForeground, #bbbbbb);
      --primary: var(--vscode-button-background, #365880);
      --primaryfg: var(--vscode-button-foreground, #fff);
      --apply: #3d6b3d;
      --applyfg: #e8f5e8;
    }
    html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg);
      font: 13px/1.4 var(--vscode-font-family, Segoe UI, sans-serif); }
    .dialog { height: 100%; display: flex; flex-direction: column; padding: 14px 16px 12px; gap: 10px; }
    h1 { margin: 0; font-size: 14px; font-weight: 600; }
    .heading { color: var(--muted); font-size: 12px; }
    .body { flex: 1; min-height: 0; display: flex; gap: 12px; }
    .table-wrap { flex: 1; min-width: 0; overflow: auto; border: 1px solid var(--border); background: #2b2d30; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: 600; font-size: 12px; padding: 6px 10px;
      background: var(--header); border-bottom: 1px solid var(--border); position: sticky; top: 0; }
    td { padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); vertical-align: middle; }
    .row { cursor: pointer; user-select: none; }
    .row:hover { background: var(--row); }
    .row.selected { background: var(--sel); color: var(--selfg); }
    .row.selected .dir { color: color-mix(in srgb, var(--selfg) 70%, transparent); }
    .name { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
    .icon { font-size: 13px; }
    .file { font-weight: 600; }
    .dir { color: var(--muted); font-size: 12px; }
    .actions { display: flex; flex-direction: column; gap: 8px; width: 132px; flex-shrink: 0; }
    button { height: 28px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; font: inherit; }
    .secondary { background: var(--btn); color: var(--btnfg); }
    .primary { background: var(--primary); color: var(--primaryfg); }
    .apply { background: var(--apply); color: var(--applyfg); }
    button:hover { filter: brightness(1.08); }
    button:disabled { opacity: 0.45; cursor: default; filter: none; }
  </style>
</head>
<body>
  <div class="dialog">
    <h1>Conflicts</h1>
    <div class="heading">${escapeHtml(state.heading)}</div>
    <div class="body">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Yours (${escapeHtml(state.oursBranch)})</th>
              <th>Theirs (${escapeHtml(state.theirsBranch)})</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="actions">
        <button class="secondary" id="ours">Accept Yours</button>
        <button class="secondary" id="theirs">Accept Theirs</button>
        <button class="apply" id="apply">Apply</button>
        <button class="primary" id="merge">Merge...</button>
      </div>
    </div>
  </div>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const rows = [...document.querySelectorAll(".row")];
    const selected = new Set(${JSON.stringify(selected)});
    let anchor = Math.max(0, rows.findIndex((row) => selected.has(row.dataset.path)));
    function paint() {
      rows.forEach((row) => row.classList.toggle("selected", selected.has(row.dataset.path)));
    }
    function notify() {
      vscode.postMessage({ type: "select", paths: [...selected] });
    }
    function paths() {
      return rows.filter((row) => selected.has(row.dataset.path)).map((row) => row.dataset.path);
    }
    function selectRange(from, to, additive) {
      if (!additive) selected.clear();
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      for (let i = start; i <= end; i++) selected.add(rows[i].dataset.path);
    }
    rows.forEach((row, index) => {
      row.addEventListener("click", (event) => {
        if (event.shiftKey) {
          selectRange(anchor, index, event.ctrlKey || event.metaKey);
        } else if (event.ctrlKey || event.metaKey) {
          if (selected.has(row.dataset.path)) selected.delete(row.dataset.path);
          else selected.add(row.dataset.path);
          anchor = index;
        } else {
          selected.clear();
          selected.add(row.dataset.path);
          anchor = index;
        }
        if (!selected.size) {
          selected.add(row.dataset.path);
          anchor = index;
        }
        paint();
        notify();
      });
      row.addEventListener("dblclick", () => vscode.postMessage({ type: "merge", paths: [row.dataset.path] }));
    });
    document.getElementById("ours").addEventListener("click", () => vscode.postMessage({ type: "acceptOurs", paths: paths() }));
    document.getElementById("theirs").addEventListener("click", () => vscode.postMessage({ type: "acceptTheirs", paths: paths() }));
    document.getElementById("apply").addEventListener("click", () => vscode.postMessage({ type: "apply", paths: paths() }));
    document.getElementById("merge").addEventListener("click", () => vscode.postMessage({ type: "merge", paths: paths() }));
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        rows.forEach((row) => selected.add(row.dataset.path));
        paint();
        notify();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(rows.length - 1, Math.max(0, anchor + delta));
        if (event.shiftKey) selectRange(anchor, next, false);
        else {
          selected.clear();
          selected.add(rows[next].dataset.path);
          anchor = next;
        }
        paint();
        notify();
        rows[next]?.focus();
        return;
      }
      if (event.key === "Enter") vscode.postMessage({ type: "merge", paths: paths() });
      if (event.key === "Escape") vscode.postMessage({ type: "close" });
    });
  </script>
</body>
</html>`;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function toRow(file: GitFileChange): ConflictRow {
  const posix = file.path.replace(/\\/g, "/");
  return {
    path: file.path,
    name: path.posix.basename(posix),
    directory: path.posix.dirname(posix).replace(/\//g, path.sep),
    ours: sideLabel(file.oursSide),
    theirs: sideLabel(file.theirsSide),
  };
}

function sideLabel(side?: ConflictSideKind): string {
  if (side === "added") {
    return "Added";
  }
  if (side === "deleted") {
    return "Deleted";
  }
  return "Modified";
}

function conflictHeading(operation: GitOperation, ours: string, theirs: string): string {
  if (operation === "rebase") {
    return `Rebasing ${ours} onto ${theirs}`;
  }
  if (operation === "cherry-pick") {
    return `Cherry-picking ${theirs} onto ${ours}`;
  }
  if (operation === "revert") {
    return `Reverting ${theirs}`;
  }
  return `Merging branch ${theirs} into branch ${ours}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
