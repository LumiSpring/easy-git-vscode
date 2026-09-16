import * as vscode from "vscode";

export function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: "commit" | "log" | "merge",
): string {
  const n = nonce();
  const files =
    view === "commit"
      ? { js: "commit.js", css: "commit.css" }
      : view === "merge"
        ? { js: "merge.js", css: "merge.css" }
        : { js: "git-log.js", css: "git-log.css" };
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", files.js));
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", files.css));
  const fallbackCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "style.css"));
  const title = view === "merge" ? "Merge" : "Easy Git";

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri}" />
    <link rel="stylesheet" href="${fallbackCss}" />
    <title>${title}</title>
  </head>
  <body data-view="${view}">
    <div id="root"></div>
    <script nonce="${n}" src="${jsUri}"></script>
  </body>
</html>`;
}
