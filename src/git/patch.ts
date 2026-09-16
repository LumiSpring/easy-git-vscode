import * as path from "node:path";
import { t } from "../i18n";

const HEADER_PREFIXES = ["diff --git ", "--- ", "+++ ", "rename from ", "rename to ", "copy from ", "copy to "] as const;

export function normalizeGitPatch(patch: string, repoRoot: string): string {
  const eol = patch.includes("\r\n") ? "\r\n" : "\n";
  return patch.split(/\r?\n/).map((line) => rewriteHeaderLine(line, repoRoot)).join(eol);
}

export function patchHasUnsafePaths(patch: string): boolean {
  for (const line of patch.split(/\r?\n/)) {
    if (!HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    if (/[A-Za-z]:[\\/]/.test(line)) {
      return true;
    }
  }
  return false;
}

function rewriteHeaderLine(line: string, repoRoot: string): string {
  if (line.startsWith("diff --git ")) {
    return rewriteDiffGitLine(line, repoRoot);
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    const side = line.startsWith("--- ") ? "a" : "b";
    const token = parseGitPathToken(line.slice(4));
    const relative = toRepoRelative(repoRoot, stripAbPrefix(token.value));
    if (relative === null) {
      return `${line.slice(0, 4)}/dev/null`;
    }
    return `${line.slice(0, 4)}${formatGitPath(`${side}/${relative}`)}`;
  }
  for (const prefix of ["rename from ", "rename to ", "copy from ", "copy to "] as const) {
    if (line.startsWith(prefix)) {
      const token = parseGitPathToken(line.slice(prefix.length));
      const relative = toRepoRelative(repoRoot, stripAbPrefix(token.value));
      if (relative === null) {
        return line;
      }
      return `${prefix}${formatGitPath(relative)}`;
    }
  }
  return line;
}

function rewriteDiffGitLine(line: string, repoRoot: string): string {
  const rest = line.slice("diff --git ".length);
  const first = parseGitPathToken(rest);
  const second = parseGitPathToken(first.rest);
  let a = toRepoRelative(repoRoot, stripAbPrefix(first.value));
  let b = toRepoRelative(repoRoot, stripAbPrefix(second.value));
  if (a === null && b) {
    a = b;
  }
  if (b === null && a) {
    b = a;
  }
  if (a === null || b === null) {
    return line;
  }
  return `diff --git ${formatGitPath(`a/${a}`)} ${formatGitPath(`b/${b}`)}`;
}

function parseGitPathToken(input: string): { value: string; rest: string } {
  const text = input.trimStart();
  if (!text) {
    return { value: "", rest: "" };
  }
  if (text.startsWith('"')) {
    let raw = "";
    for (let i = 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"') {
        return { value: raw, rest: text.slice(i + 1) };
      }
      if (ch === "\\" && i + 1 < text.length) {
        const next = text[i + 1];
        const escaped: Record<string, string> = { "\\": "\\", '"': '"', n: "\n", t: "\t", r: "\r" };
        raw += escaped[next] ?? next;
        i += 1;
        continue;
      }
      raw += ch;
    }
    return { value: raw, rest: "" };
  }
  const space = text.search(/\s/);
  if (space < 0) {
    return { value: text, rest: "" };
  }
  return { value: text.slice(0, space), rest: text.slice(space) };
}

function stripAbPrefix(value: string): string {
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }
  return value;
}

function isNullPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  return lower === "/dev/null" || lower === "dev/null" || lower === "nul" || lower === "nul:";
}

export function toRepoRelative(repoRoot: string, filePath: string): string | null {
  if (!filePath || isNullPath(filePath)) {
    return null;
  }
  let candidate = filePath.replace(/\\/g, "/");
  const msys = candidate.match(/^\/([A-Za-z])\/(.*)$/);
  if (msys && !candidate.startsWith("/dev/")) {
    candidate = `${msys[1]}:/${msys[2]}`;
  }
  const rootPosix = path.resolve(repoRoot).replace(/\\/g, "/").replace(/\/+$/, "");
  const rootPrefix = rootPosix.toLowerCase();
  const candidateLower = candidate.toLowerCase();
  if (candidateLower === rootPrefix) {
    return "";
  }
  if (candidateLower.startsWith(`${rootPrefix}/`)) {
    return candidate.slice(rootPosix.length).replace(/^\/+/, "");
  }
  const looksAbsolute = path.isAbsolute(filePath) || path.isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate);
  if (looksAbsolute) {
    const relative = path.relative(repoRoot, /^[A-Za-z]:/.test(candidate) ? candidate : filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return candidate.replace(/^\/+/, "");
    }
    return relative.replace(/\\/g, "/");
  }
  return candidate.replace(/^\/+/, "");
}

function formatGitPath(value: string): string {
  if (/[\s"\\\n\t]/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }
  return value;
}

export function extractFilePatch(patch: string, filePath: string): string | undefined {
  const want = filePath.replace(/\\/g, "/").toLowerCase();
  const blocks = splitGitPatch(patch);
  return blocks.find((block) => block.paths.some((item) => item.replace(/\\/g, "/").toLowerCase() === want))?.text;
}

export function patchFileIsNew(filePatch: string): boolean {
  return /new file mode/.test(filePatch) || /^--- \/dev\/null/m.test(filePatch) || /^--- nul/im.test(filePatch);
}

export function patchFileIsDeleted(filePatch: string): boolean {
  return /deleted file mode/.test(filePatch) || /^\+\+\+ \/dev\/null/m.test(filePatch) || /^\+\+\+ nul/im.test(filePatch);
}

export function applyUnifiedDiff(original: string, filePatch: string): string {
  if (/GIT binary patch|Binary files /.test(filePatch)) {
    throw new Error(t("error.binaryPreview"));
  }
  const hunks = parseUnifiedHunks(filePatch);
  if (!hunks.length) {
    if (patchFileIsNew(filePatch)) {
      return addedLinesAsFile(filePatch);
    }
    return original;
  }
  const source = splitFileLines(original);
  const result: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = Math.max(hunk.oldStart - 1, 0);
    while (cursor < start && cursor < source.length) {
      result.push(source[cursor] ?? "");
      cursor += 1;
    }
    for (const line of hunk.lines) {
      if (line.kind === "context" || line.kind === "remove") {
        cursor += 1;
      }
      if (line.kind === "context" || line.kind === "add") {
        result.push(line.text);
      }
    }
  }
  while (cursor < source.length) {
    result.push(source[cursor] ?? "");
    cursor += 1;
  }
  return result.length ? `${result.join("\n")}\n` : "";
}

function splitGitPatch(patch: string): Array<{ paths: string[]; text: string }> {
  const lines = patch.split(/\r?\n/);
  const blocks: Array<{ paths: string[]; text: string[] }> = [];
  let current: { paths: string[]; text: string[] } | undefined;
  const flush = () => {
    if (current) {
      blocks.push(current);
    }
    current = undefined;
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = { paths: pathsFromDiffGit(line), text: [line] };
      continue;
    }
    if (!current) {
      continue;
    }
    current.text.push(line);
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const token = parseGitPathToken(line.slice(4)).value;
      const relative = stripAbPrefix(token);
      if (relative && !isNullPath(relative)) {
        current.paths.push(relative.replace(/\\/g, "/"));
      }
    }
  }
  flush();
  return blocks.map((block) => ({
    paths: [...new Set(block.paths)],
    text: block.text.join("\n"),
  }));
}

function pathsFromDiffGit(line: string): string[] {
  const rest = line.slice("diff --git ".length);
  const first = parseGitPathToken(rest);
  const second = parseGitPathToken(first.rest);
  return [first.value, second.value]
    .map((value) => stripAbPrefix(value).replace(/\\/g, "/"))
    .filter((value) => value && !isNullPath(value));
}

function splitFileLines(text: string): string[] {
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function addedLinesAsFile(filePatch: string): string {
  const lines = filePatch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

interface UnifiedHunk {
  oldStart: number;
  lines: Array<{ kind: "context" | "add" | "remove"; text: string }>;
}

function parseUnifiedHunks(filePatch: string): UnifiedHunk[] {
  const hunks: UnifiedHunk[] = [];
  let current: UnifiedHunk | undefined;
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  for (const line of filePatch.split(/\r?\n/)) {
    const match = line.match(header);
    if (match) {
      current = { oldStart: Number(match[1]) || 0, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith("\\") || line.startsWith("diff ") || line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "remove", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.lines.push({ kind: "context", text: line.slice(1) });
    }
  }
  return hunks;
}
