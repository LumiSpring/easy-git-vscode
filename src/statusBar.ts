import * as vscode from "vscode";
import type { GitOperation } from "./ipc/protocol";
import { t } from "./i18n";

export class StatusBarController {
  private branchItem: vscode.StatusBarItem;
  private opItem: vscode.StatusBarItem;
  private hasRepo = false;

  constructor() {
    this.branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.branchItem.command = "easyGit.showBranchMenu";
    this.branchItem.tooltip = t("tooltip.branches");
    this.opItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.opItem.tooltip = t("tooltip.operation");
  }

  dispose(): void {
    this.branchItem.dispose();
    this.opItem.dispose();
  }

  update(hasRepo: boolean, branch?: string, ahead = 0, behind = 0, operation: GitOperation = "none"): void {
    this.hasRepo = hasRepo;
    if (!this.hasRepo) {
      this.branchItem.text = "$(add) Initialize Git";
      this.branchItem.tooltip = t("tooltip.initGit");
      this.branchItem.command = "easyGit.initRepository";
      this.branchItem.show();
      this.opItem.hide();
      return;
    }
    this.branchItem.command = "easyGit.showBranchMenu";
    this.branchItem.tooltip = t("tooltip.branches");
    const arrows = `${ahead ? ` ↑${ahead}` : ""}${behind ? ` ↓${behind}` : ""}`;
    this.branchItem.text = `$(git-branch) ${branch ?? "HEAD"}${arrows}`;
    this.branchItem.show();

    if (operation === "none") {
      this.opItem.hide();
      return;
    }
    this.opItem.text = `$(sync) ${operation}`;
    this.opItem.tooltip = t("tooltip.operation");
    this.opItem.command = "easyGit.operationMenu";
    this.opItem.show();
  }
}
