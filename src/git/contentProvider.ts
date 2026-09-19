import * as vscode from "vscode";
import { GitService } from "./GitService";

export class StringContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "easy-git-doc";

  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  put(key: string, content: string, filePath: string): vscode.Uri {
    this.contents.set(key, content);
    const uri = vscode.Uri.from({
      scheme: StringContentProvider.scheme,
      path: `/${filePath}`,
      query: new URLSearchParams({ key }).toString(),
    });
    this.emitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = new URLSearchParams(uri.query).get("key") ?? uri.path.replace(/^\//, "");
    return this.contents.get(key) ?? "";
  }
}

export class GitRevisionContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "easy-git";
  private readonly served = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    this.served.add(uri.toString());
    const params = new URLSearchParams(uri.query);
    const ref = params.get("ref") ?? "HEAD";
    const filePath = params.get("path") ?? uri.path.replace(/^\//, "");
    try {
      return await this.git.showFile(ref, filePath);
    } catch {
      return "";
    }
  }

  invalidate(): void {
    for (const value of this.served) {
      this.emitter.fire(vscode.Uri.parse(value));
    }
  }

  static uri(ref: string, filePath: string, repoRoot: string): vscode.Uri {
    const query = new URLSearchParams({
      ref,
      path: filePath,
      root: repoRoot,
    }).toString();
    return vscode.Uri.from({
      scheme: GitRevisionContentProvider.scheme,
      path: `/${filePath}`,
      query,
    });
  }
}
