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

  constructor(private readonly git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const ref = params.get("ref") ?? "HEAD";
    const filePath = params.get("path") ?? uri.path.replace(/^\//, "");
    return this.git.showFile(ref, filePath);
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
