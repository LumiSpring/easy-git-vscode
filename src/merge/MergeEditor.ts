import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildResultDocument,
  buildSideDocument,
  detectEol,
  findResultConflicts,
  formatResultConflict,
  hasConflictMarkers,
  hasResultConflicts,
  toGitConflictMarkers,
  type SideHunk,
} from "../git/conflicts";
import { StringContentProvider } from "../git/contentProvider";
import type { AppHost } from "../host/AppHost";
import type { MergeBlock, MergeViewState } from "../ipc/protocol";
import { t } from "../i18n";

type MergeSide = "ours" | "theirs";
type SideState = "pending" | "accepted" | "ignored";
type HunkState = { ours: SideState; theirs: SideState };

interface MergeSession {
  relative: string;
  targetUri: vscode.Uri;
  resultUri: vscode.Uri;
  oursUri: vscode.Uri;
  theirsUri: vscode.Uri;
  state: MergeViewState;
  oursHunks: SideHunk[];
  theirsHunks: SideHunk[];
  applied: Map<string, HunkState>;
}

export class MergeEditor implements vscode.Disposable, vscode.CodeLensProvider {
  private session?: MergeSession;
  private skipRestore = false;
  private readonly lenses = new vscode.EventEmitter<void>();
  private readonly conflictDeco: vscode.TextEditorDecorationType;
  private readonly addDeco: vscode.TextEditorDecorationType;
  private readonly delDeco: vscode.TextEditorDecorationType;
  private readonly status: vscode.StatusBarItem;
  private offeredApply = false;
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeCodeLenses = this.lenses.event;

  constructor(private readonly host: AppHost) {
    this.conflictDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(199, 84, 80, 0.32)",
      overviewRulerColor: "#c75450",
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.addDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(89, 168, 105, 0.28)",
      overviewRulerColor: "#59a869",
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.delDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      color: "#8b8e94",
      backgroundColor: "rgba(139, 142, 148, 0.22)",
      textDecoration: "line-through",
      overviewRulerColor: "#8b8e94",
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.disposables.push(
      this.conflictDeco,
      this.addDeco,
      this.delDeco,
      this.status,
      this.lenses,
      vscode.languages.registerCodeLensProvider({ scheme: StringContentProvider.scheme }, this),
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, this),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.paint()),
      vscode.commands.registerCommand("easyGit.merge.apply", async () => {
        const had = Boolean(this.session);
        await this.apply();
        if (had && !this.session) {
          void vscode.window.showInformationMessage(t("toast.appliedContinue"));
        }
      }),
      vscode.commands.registerCommand("easyGit.merge.acceptOurs", (id?: string) => this.accept(id, "ours")),
      vscode.commands.registerCommand("easyGit.merge.acceptTheirs", (id?: string) => this.accept(id, "theirs")),
      vscode.commands.registerCommand("easyGit.merge.acceptBoth", (id?: string) => this.acceptBoth(id)),
      vscode.commands.registerCommand("easyGit.merge.ignoreOurs", (id?: string) => this.ignore(id, "ours")),
      vscode.commands.registerCommand("easyGit.merge.ignoreTheirs", (id?: string) => this.ignore(id, "theirs")),
      vscode.commands.registerCommand("easyGit.merge.acceptAllOurs", () => this.acceptAll("ours")),
      vscode.commands.registerCommand("easyGit.merge.acceptAllTheirs", () => this.acceptAll("theirs")),
      vscode.commands.registerCommand("easyGit.merge.nextConflict", () => this.jump(1)),
      vscode.commands.registerCommand("easyGit.merge.prevConflict", () => this.jump(-1)),
    );
  }

  currentRelative(): string | undefined {
    return this.session?.relative;
  }

  dispose(): void {
    this.status.hide();
    void this.closeSides();
    this.session = undefined;
    for (const item of this.disposables) {
      item.dispose();
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const session = this.session;
    if (!session) {
      return [];
    }
    const side = this.sideOf(document.uri);
    if (side) {
      return this.sideLenses(document, side);
    }
    if (this.isResultUri(document.uri)) {
      return this.resultLenses(document);
    }
    return [];
  }

  private sideLenses(document: vscode.TextDocument, side: MergeSide): vscode.CodeLens[] {
    const session = this.session;
    if (!session) {
      return [];
    }
    const hunks = side === "ours" ? session.oursHunks : session.theirsHunks;
    const lenses: vscode.CodeLens[] = [];
    for (const hunk of hunks) {
      if (hunk.kind !== "conflict") {
        continue;
      }
      if (this.sideStatus(hunk.id, side) !== "pending") {
        continue;
      }
      const line = Math.min(Math.max(hunk.startLine, 0), Math.max(document.lineCount - 1, 0));
      const range = new vscode.Range(line, 0, line, 0);
      if (side === "ours") {
        lenses.push(
          new vscode.CodeLens(range, { title: "× Ignore", command: "easyGit.merge.ignoreOurs", arguments: [hunk.id] }),
          new vscode.CodeLens(range, { title: "» Accept Yours", command: "easyGit.merge.acceptOurs", arguments: [hunk.id] }),
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, { title: "« Accept Theirs", command: "easyGit.merge.acceptTheirs", arguments: [hunk.id] }),
          new vscode.CodeLens(range, { title: "× Ignore", command: "easyGit.merge.ignoreTheirs", arguments: [hunk.id] }),
        );
      }
    }
    return lenses;
  }

  private resultLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const markers = findResultConflicts(document.getText());
    const hunks = this.conflictBlocks();
    return markers.map((marker, index) => {
      const hunk = hunks[index];
      const range = new vscode.Range(document.positionAt(marker.start), document.positionAt(marker.start));
      return [
        new vscode.CodeLens(range, { title: "Accept Yours", command: "easyGit.merge.acceptOurs", arguments: [hunk?.id] }),
        new vscode.CodeLens(range, { title: "Accept Theirs", command: "easyGit.merge.acceptTheirs", arguments: [hunk?.id] }),
        new vscode.CodeLens(range, { title: "Accept Both", command: "easyGit.merge.acceptBoth", arguments: [hunk?.id] }),
      ];
    }).flat();
  }

  async open(filePath: string): Promise<void> {
    const state = await this.host.loadMergeState(filePath);
    if (!state || !this.host.git.repoRoot) {
      return;
    }
    await this.closeSides();
    const relative = state.path;
    const targetUri = vscode.Uri.file(path.join(this.host.git.repoRoot, relative));
    await this.closeNativeMergeEditors(targetUri);
    let resultDoc = await vscode.workspace.openTextDocument(targetUri);
    const current = resultDoc.getText();
    const eol = detectEol(current);
    if (hasConflictMarkers(current) || hasResultConflicts(current)) {
      const draft = buildResultDocument(state.blocks, eol);
      if (draft !== current) {
        const edit = new vscode.WorkspaceEdit();
        const all = new vscode.Range(resultDoc.positionAt(0), resultDoc.positionAt(current.length));
        edit.replace(resultDoc.uri, all, draft);
        await vscode.workspace.applyEdit(edit);
        resultDoc = await vscode.workspace.openTextDocument(targetUri);
      }
    }
    const oursView = buildSideDocument(state.blocks, "ours");
    const theirsView = buildSideDocument(state.blocks, "theirs");
    const fileName = path.basename(relative);
    const oursUri = this.host.virtualDocs.put(`merge-ours:${relative}`, oursView.content, `Yours/${fileName} (Yours)`);
    const theirsUri = this.host.virtualDocs.put(`merge-theirs:${relative}`, theirsView.content, `Theirs/${fileName} (Theirs)`);
    const oursDoc = await vscode.workspace.openTextDocument(oursUri);
    const theirsDoc = await vscode.workspace.openTextDocument(theirsUri);
    if (resultDoc.languageId && resultDoc.languageId !== "plaintext") {
      await vscode.languages.setTextDocumentLanguage(oursDoc, resultDoc.languageId);
      await vscode.languages.setTextDocumentLanguage(theirsDoc, resultDoc.languageId);
    }

    this.session = {
      relative,
      targetUri,
      resultUri: targetUri,
      oursUri,
      theirsUri,
      state,
      oursHunks: oursView.hunks,
      theirsHunks: theirsView.hunks,
      applied: new Map(),
    };
    this.offeredApply = false;

    await this.openThreeColumns(oursDoc, resultDoc, theirsDoc);
    await vscode.commands.executeCommand("setContext", "easyGit.mergeActive", true);
    this.syncFromDocument();
    this.paint();
    setTimeout(() => {
      this.syncFromDocument();
      this.paint();
    }, 200);
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (!this.session || !this.isResultUri(event.document.uri)) {
      return;
    }
    this.syncFromDocument();
    this.paint();
  }

  private syncFromDocument(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    const text = this.resultText();
    const markers = findResultConflicts(text);
    for (const block of this.conflictBlocks()) {
      const marker = this.markerFor(block, text);
      if (marker) {
        if (marker.ours && marker.theirs) {
          session.applied.set(block.id, { ours: "pending", theirs: "pending" });
        } else {
          session.applied.set(block.id, {
            ours: marker.ours ? "pending" : "ignored",
            theirs: marker.theirs ? "pending" : "ignored",
          });
        }
        continue;
      }
      const current = session.applied.get(block.id) ?? { ours: "pending" as const, theirs: "pending" as const };
      if (current.ours === "accepted" && block.ours && !text.includes(block.ours)) {
        current.ours = "pending";
      }
      if (current.theirs === "accepted" && block.theirs && !text.includes(block.theirs)) {
        current.theirs = "pending";
      }
      session.applied.set(block.id, current);
    }
    const remaining = this.unresolvedIds().size;
    const canApply = remaining === 0 && markers.length === 0 && !hasConflictMarkers(text);
    void vscode.commands.executeCommand("setContext", "easyGit.mergeCanApply", canApply);
    this.status.text = canApply
      ? "$(check) Apply Merge"
      : `$(git-merge) ${t("status.mergeRemaining", { count: remaining })}`;
    this.status.tooltip = canApply ? t("hint.mergeApplyReady") : t("hint.mergeApplyPending");
    this.status.command = canApply ? "easyGit.merge.apply" : "easyGit.merge.nextConflict";
    this.status.backgroundColor = canApply ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    this.status.show();
    this.lenses.fire();
    if (canApply && !this.offeredApply) {
      this.offeredApply = true;
      void vscode.window
        .showInformationMessage(t("toast.mergeOffer"), "Apply")
        .then((choice) => {
          if (choice === "Apply") {
            void this.apply();
          }
        });
    }
    if (!canApply) {
      this.offeredApply = false;
    }
  }

  private remainingConflicts(): Extract<MergeBlock, { kind: "conflict" }>[] {
    const ids = this.unresolvedIds();
    return this.conflictBlocks().filter((block) => ids.has(block.id));
  }

  private unresolvedIds(): Set<string> {
    const ids = new Set<string>();
    const text = this.resultText();
    for (const block of this.conflictBlocks()) {
      const marker = this.markerFor(block, text);
      const state = this.hunkState(block.id);
      if (marker || state.ours === "pending" || state.theirs === "pending") {
        ids.add(block.id);
      }
    }
    return ids;
  }

  private hunkState(id: string): HunkState {
    return this.session?.applied.get(id) ?? { ours: "pending", theirs: "pending" };
  }

  private sideStatus(id: string, side: MergeSide): SideState {
    return this.hunkState(id)[side];
  }

  private conflictBlocks(): Array<Extract<MergeBlock, { kind: "conflict" }>> {
    return (this.session?.state.blocks ?? []).filter(
      (block): block is Extract<MergeBlock, { kind: "conflict" }> => block.kind === "conflict",
    );
  }

  private resultText(): string {
    if (!this.session) {
      return "";
    }
    return (
      vscode.workspace.textDocuments.find((doc) => this.isResultUri(doc.uri))?.getText() ?? ""
    );
  }

  private async resultEditor(): Promise<vscode.TextEditor | undefined> {
    if (!this.session) {
      return undefined;
    }
    const doc = await vscode.workspace.openTextDocument(this.session.resultUri);
    return this.showDocument(doc, vscode.ViewColumn.Two, false);
  }

  private async showDocument(
    doc: vscode.TextDocument,
    column: vscode.ViewColumn,
    preserveFocus: boolean,
    fallback = true,
  ): Promise<vscode.TextEditor> {
    try {
      return await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false, preserveFocus });
    } catch {
      if (!fallback) {
        throw new Error(t("error.openEditor", { path: doc.uri.fsPath }));
      }
      try {
        return await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
      } catch {
        throw new Error(t("error.openEditor", { path: doc.uri.fsPath }));
      }
    }
  }

  private async openThreeColumns(
    oursDoc: vscode.TextDocument,
    resultDoc: vscode.TextDocument,
    theirsDoc: vscode.TextDocument,
  ): Promise<void> {
    try {
      await vscode.commands.executeCommand("vscode.setEditorLayout", {
        orientation: 0,
        groups: [{ size: 0.33 }, { size: 0.34 }, { size: 0.33 }],
      });
    } catch {
      /* layout API may be missing */
    }
    await this.tryShowInColumn(oursDoc, vscode.ViewColumn.One, true);
    await this.tryShowInColumn(resultDoc, vscode.ViewColumn.Two, false);
    await this.tryShowInColumn(theirsDoc, vscode.ViewColumn.Three, true);
    if (this.visibleColumnCount() >= 3) {
      return;
    }
    await this.showDocument(oursDoc, vscode.ViewColumn.One, false);
    await vscode.window.showTextDocument(resultDoc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
      preserveFocus: false,
    });
    await vscode.window.showTextDocument(theirsDoc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false,
      preserveFocus: true,
    });
  }

  private async tryShowInColumn(
    doc: vscode.TextDocument,
    column: vscode.ViewColumn,
    preserveFocus: boolean,
  ): Promise<void> {
    try {
      await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false, preserveFocus });
    } catch {
      /* column may not exist yet */
    }
  }

  private visibleColumnCount(): number {
    return new Set(
      vscode.window.visibleTextEditors.map((editor) => editor.viewColumn).filter((column): column is vscode.ViewColumn => column !== undefined),
    ).size;
  }

  private async accept(id: string | undefined, side: MergeSide): Promise<void> {
    const hunk = this.hunkById(id);
    if (!hunk) {
      return;
    }
    const editor = await this.resultEditor();
    if (!editor || !this.session) {
      return;
    }
    const current = this.markerFor(hunk, editor.document.getText());
    const prev = this.hunkState(hunk.id);
    const next: HunkState = { ...prev, [side]: "accepted" };
    this.session.applied.set(hunk.id, next);
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    if (current) {
      await this.replaceRange(editor, current.start, current.end, this.slotText(this.combined(hunk, next), eol));
      return;
    }
    const previousText = this.combined(hunk, prev);
    const nextText = this.combined(hunk, next);
    if (!previousText || previousText === nextText) {
      this.syncFromDocument();
      this.paint();
      return;
    }
    const start = editor.document.getText().indexOf(previousText);
    if (start < 0) {
      this.syncFromDocument();
      this.paint();
      return;
    }
    await this.replaceRange(editor, start, start + previousText.length, nextText);
  }

  private async ignore(id: string | undefined, side: MergeSide): Promise<void> {
    const hunk = this.hunkById(id);
    if (!hunk || !this.session) {
      return;
    }
    const editor = await this.resultEditor();
    if (!editor) {
      return;
    }
    const marker = this.markerFor(hunk, editor.document.getText());
    const prev = this.hunkState(hunk.id);
    const next: HunkState = { ...prev, [side]: "ignored" };
    this.session.applied.set(hunk.id, next);
    if (!marker) {
      this.syncFromDocument();
      this.paint();
      return;
    }
    const ours = side === "ours" ? "" : marker.ours;
    const theirs = side === "theirs" ? "" : marker.theirs;
    const eol = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    await this.replaceRange(editor, marker.start, marker.end, formatResultConflict(ours, theirs, eol));
  }

  private async acceptAll(side: MergeSide): Promise<void> {
    const editor = await this.resultEditor();
    if (!editor) {
      return;
    }
    const hunks = [...this.remainingConflicts()].reverse();
    await editor.edit((builder) => {
      for (const hunk of hunks) {
        const marker = this.markerFor(hunk, editor.document.getText());
        if (!marker) {
          continue;
        }
        const prev = this.hunkState(hunk.id);
        const next: HunkState = {
          ours: side === "ours" ? "accepted" : prev.ours === "accepted" ? "accepted" : "ignored",
          theirs: side === "theirs" ? "accepted" : prev.theirs === "accepted" ? "accepted" : "ignored",
        };
        const range = new vscode.Range(editor.document.positionAt(marker.start), editor.document.positionAt(marker.end));
        const eol = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
        builder.replace(range, this.slotText(this.combined(hunk, next), eol));
      }
    });
    for (const hunk of hunks) {
      const prev = this.hunkState(hunk.id);
      this.session?.applied.set(hunk.id, {
        ours: side === "ours" ? "accepted" : prev.ours === "accepted" ? "accepted" : "ignored",
        theirs: side === "theirs" ? "accepted" : prev.theirs === "accepted" ? "accepted" : "ignored",
      });
    }
    this.syncFromDocument();
    this.paint();
  }

  private async jump(delta: number): Promise<void> {
    const editor = await this.resultEditor();
    if (!editor) {
      return;
    }
    const markers = findResultConflicts(editor.document.getText());
    if (!markers.length) {
      return;
    }
    const cursor = editor.document.offsetAt(editor.selection.active);
    let index = markers.findIndex((marker) => cursor >= marker.start && cursor <= marker.end);
    if (index < 0) {
      index = markers.findIndex((marker) => marker.start > cursor);
    }
    if (index < 0) {
      index = 0;
    }
    const next = markers[(index + delta + markers.length) % markers.length];
    if (!next) {
      return;
    }
    const range = new vscode.Range(editor.document.positionAt(next.start), editor.document.positionAt(next.end));
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(range.start, range.start);
  }

  private async apply(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    const editor = await this.resultEditor();
    const text = editor?.document.getText() ?? this.resultText();
    const leftover = this.unresolvedIds().size || findResultConflicts(text).length;
    if (leftover > 0 || hasResultConflicts(text) || hasConflictMarkers(text)) {
      void vscode.window.showWarningMessage(t("toast.mergeRemaining", { count: leftover }));
      await this.jump(0);
      return;
    }
    if (editor?.document.isDirty) {
      await editor.document.save();
    }
    await this.host.git.execOk(["add", "--", session.relative]);
    this.skipRestore = true;
    await this.closeMergeWindow();
    await this.host.refresh();
  }

  async dismissIfPaths(paths: string[]): Promise<void> {
    const session = this.session;
    if (!session || !this.containsRelative(paths, session.relative)) {
      return;
    }
    this.skipRestore = true;
    await this.closeMergeWindow();
  }

  async applyIfReady(): Promise<boolean> {
    if (!this.session) {
      return false;
    }
    const editor = await this.resultEditor();
    const text = editor?.document.getText() ?? this.resultText();
    if (this.unresolvedIds().size > 0 || hasResultConflicts(text) || hasConflictMarkers(text)) {
      return false;
    }
    await this.apply();
    return true;
  }

  private async replaceRange(editor: vscode.TextEditor, start: number, end: number, text: string): Promise<void> {
    const range = new vscode.Range(editor.document.positionAt(start), editor.document.positionAt(end));
    await editor.edit((builder) => {
      builder.replace(range, text);
    });
  }

  private async acceptBoth(id?: string): Promise<void> {
    await this.accept(id, "ours");
    await this.accept(id, "theirs");
  }

  private markerFor(hunk: Extract<MergeBlock, { kind: "conflict" }>, text: string) {
    const markers = findResultConflicts(text);
    if (!markers.length) {
      return undefined;
    }
    const exact = markers.find((item) => this.sameHunkText(item.ours, hunk.ours) && this.sameHunkText(item.theirs, hunk.theirs));
    if (exact) {
      return exact;
    }
    const partial = markers.find((item) => {
      if (Boolean(item.ours) === Boolean(item.theirs)) {
        return false;
      }
      return item.ours
        ? this.sameHunkText(item.ours, hunk.ours)
        : this.sameHunkText(item.theirs, hunk.theirs);
    });
    if (partial) {
      return partial;
    }
    const pending = this.conflictBlocks().filter((block) => {
      const state = this.hunkState(block.id);
      return state.ours === "pending" && state.theirs === "pending";
    });
    if (pending.length !== markers.length) {
      return undefined;
    }
    const index = pending.findIndex((block) => block.id === hunk.id);
    return index >= 0 ? markers[index] : undefined;
  }

  private sameHunkText(left: string, right: string): boolean {
    const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
    return normalize(left) === normalize(right);
  }

  private sideOf(uri: vscode.Uri): MergeSide | undefined {
    if (uri.scheme !== StringContentProvider.scheme) {
      return undefined;
    }
    if (uri.path.startsWith("/Yours/") || uri.path === "/Yours") {
      return "ours";
    }
    if (uri.path.startsWith("/Theirs/") || uri.path === "/Theirs") {
      return "theirs";
    }
    if (!this.session) {
      return undefined;
    }
    const key = new URLSearchParams(uri.query).get("key");
    if (key === `merge-ours:${this.session.relative}`) {
      return "ours";
    }
    if (key === `merge-theirs:${this.session.relative}`) {
      return "theirs";
    }
    return undefined;
  }

  private sameFile(left: vscode.Uri, right: vscode.Uri): boolean {
    return left.scheme === right.scheme && left.fsPath.replace(/\\/g, "/").toLowerCase() === right.fsPath.replace(/\\/g, "/").toLowerCase();
  }

  private slotText(text: string, eol: string): string {
    if (!text) {
      return "";
    }
    return text.endsWith("\n") ? text.replace(/\r?\n$/u, "") + eol : text + eol;
  }

  private combined(hunk: Extract<MergeBlock, { kind: "conflict" }>, applied: HunkState): string {
    const parts: string[] = [];
    if (applied.ours === "accepted") {
      parts.push(hunk.ours);
    }
    if (applied.theirs === "accepted") {
      parts.push(hunk.theirs);
    }
    return parts.filter((part) => part.length > 0).join("\n");
  }

  private hunkById(id?: string): Extract<MergeBlock, { kind: "conflict" }> | undefined {
    if (!id) {
      return this.remainingConflicts()[0] ?? this.conflictBlocks()[0];
    }
    return this.conflictBlocks().find((block) => block.id === id);
  }

  private paint(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (this.isResultEditor(editor)) {
        const conflict: vscode.Range[] = [];
        const added: vscode.Range[] = [];
        for (const marker of findResultConflicts(editor.document.getText())) {
          conflict.push(new vscode.Range(editor.document.positionAt(marker.start), editor.document.positionAt(marker.end)));
          if (marker.theirs) {
            const theirsAt = editor.document.getText().indexOf(marker.theirs, marker.start);
            if (theirsAt >= 0) {
              added.push(new vscode.Range(editor.document.positionAt(theirsAt), editor.document.positionAt(theirsAt + marker.theirs.length)));
            }
          }
        }
        editor.setDecorations(this.conflictDeco, conflict);
        editor.setDecorations(this.addDeco, added);
        editor.setDecorations(this.delDeco, []);
        continue;
      }
      const side = this.sideOf(editor.document.uri);
      if (!side) {
        continue;
      }
      const hunks = side === "ours" ? session.oursHunks : session.theirsHunks;
      const conflict: vscode.Range[] = [];
      const added: vscode.Range[] = [];
      const deleted: vscode.Range[] = [];
      for (const hunk of hunks) {
        const range = this.hunkRange(editor.document, hunk);
        if (hunk.kind === "conflict") {
          if (this.sideStatus(hunk.id, side) === "pending") {
            conflict.push(range);
          }
        } else if ((hunk.kind === "ours" && side === "ours") || (hunk.kind === "theirs" && side === "theirs")) {
          added.push(range);
        } else if (hunk.kind === "ours" || hunk.kind === "theirs") {
          deleted.push(range);
        }
      }
      editor.setDecorations(this.conflictDeco, conflict);
      editor.setDecorations(this.addDeco, added);
      editor.setDecorations(this.delDeco, deleted);
    }
  }

  private hunkRange(document: vscode.TextDocument, hunk: SideHunk): vscode.Range {
    const start = Math.min(hunk.startLine, Math.max(document.lineCount - 1, 0));
    const end = Math.min(Math.max(hunk.endLine - 1, start), Math.max(document.lineCount - 1, 0));
    return new vscode.Range(start, 0, end, document.lineAt(end).text.length);
  }

  private async closeSides(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    if (!this.skipRestore) {
      await this.restoreGitMarkers();
    }
    await this.closeTabsByUri(new Set([session.oursUri.toString(), session.theirsUri.toString()]));
  }

  private async closeMergeWindow(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    if (!this.skipRestore) {
      await this.restoreGitMarkers();
    }
    await this.closeTabsByUri(
      new Set([session.oursUri.toString(), session.theirsUri.toString(), session.resultUri.toString()]),
    );
    try {
      await vscode.commands.executeCommand("vscode.setEditorLayout", {
        orientation: 0,
        groups: [{ size: 1 }],
      });
    } catch {
      /* layout API may be missing */
    }
    this.skipRestore = false;
    this.session = undefined;
    this.offeredApply = false;
    this.status.backgroundColor = undefined;
    this.status.hide();
    await vscode.commands.executeCommand("setContext", "easyGit.mergeActive", false);
    await vscode.commands.executeCommand("setContext", "easyGit.mergeCanApply", false);
  }

  private containsRelative(paths: string[], relative: string): boolean {
    const target = relative.replace(/\\/g, "/");
    return paths.some((item) => item.replace(/\\/g, "/") === target);
  }

  private async restoreGitMarkers(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    const doc = vscode.workspace.textDocuments.find((item) => this.isResultUri(item.uri))
      ?? await vscode.workspace.openTextDocument(session.resultUri);
    const text = doc.getText();
    const git = toGitConflictMarkers(text);
    if (git === text) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), git);
    await vscode.workspace.applyEdit(edit);
  }

  private async closeNativeMergeEditors(target: vscode.Uri): Promise<void> {
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (this.tabIsNativeMergeEditor(tab, target)) {
          tabs.push(tab);
        }
      }
    }
    await this.closeTabs(tabs);
  }

  private tabIsNativeMergeEditor(tab: vscode.Tab, target: vscode.Uri): boolean {
    const input = tab.input as unknown;
    if (!input || typeof input !== "object") {
      return false;
    }
    const record = input as Record<string, unknown>;
    if (!("input1" in record) || !("result" in record)) {
      return false;
    }
    return Object.values(record).some((value) => value instanceof vscode.Uri && this.sameFile(value, target));
  }

  private async closeTabsByUri(uris: Set<string>): Promise<void> {
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText && uris.has(tab.input.uri.toString())) {
          tabs.push(tab);
        }
      }
    }
    await this.closeTabs(tabs);
  }

  private async closeTabs(tabs: vscode.Tab[]): Promise<void> {
    for (const tab of tabs) {
      try {
        await vscode.window.tabGroups.close(tab, true);
      } catch {
        /* tab already gone */
      }
    }
  }

  private isResultUri(uri: vscode.Uri): boolean {
    return Boolean(this.session && (uri.toString() === this.session.resultUri.toString() || this.sameFile(uri, this.session.resultUri)));
  }

  private isResultEditor(editor: vscode.TextEditor): boolean {
    return this.isResultUri(editor.document.uri);
  }
}
