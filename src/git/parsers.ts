import type { FileStatus, GitFileChange } from "../ipc/protocol";
import { mapXyToStatus } from "./GitService";

export interface StatusParseResult {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  oid?: string;
  files: GitFileChange[];
}

export function parsePorcelainV2(output: string): StatusParseResult {
  const result: StatusParseResult = { ahead: 0, behind: 0, files: [] };
  const parts = output.split("\0");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    if (part.startsWith("# branch.head ")) {
      const name = part.slice("# branch.head ".length).trim();
      result.branch = name === "(detached)" ? "DETACHED" : name;
      continue;
    }
    if (part.startsWith("# branch.upstream ")) {
      result.upstream = part.slice("# branch.upstream ".length).trim();
      continue;
    }
    if (part.startsWith("# branch.ab ")) {
      const match = part.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        result.ahead = Number(match[1]);
        result.behind = Number(match[2]);
      }
      continue;
    }
    if (part.startsWith("# branch.oid ")) {
      result.oid = part.slice("# branch.oid ".length).trim();
      continue;
    }
    if (part.startsWith("1 ") || part.startsWith("u ")) {
      const file = parseOrdinaryOrUnmerged(part);
      if (file) {
        result.files.push(file);
      }
      continue;
    }
    if (part.startsWith("2 ")) {
      const parsed = parseRenameOrCopy(part, parts, i);
      i = parsed.nextIndex;
      result.files.push(parsed.file);
      continue;
    }
    if (part.startsWith("? ")) {
      result.files.push({
        path: part.slice(2),
        status: "untracked",
        staged: false,
      });
      continue;
    }
    if (part.startsWith("! ")) {
      result.files.push({
        path: part.slice(2).replace(/\/$/, ""),
        status: "ignored",
        staged: false,
      });
      continue;
    }
  }
  return result;
}

function parseRenameOrCopy(
  line: string,
  parts: string[],
  index: number,
): { file: GitFileChange; nextIndex: number } {
  const xy = line.slice(2, 4);
  const mapped = mapXyToStatus(xy[0] ?? "R", xy[1] ?? ".");
  const headerPath = takePath(line, 9);
  const tab = headerPath.indexOf("\t");
  let newPath = "";
  let oldPath = "";
  let nextIndex = index;
  if (tab >= 0) {
    newPath = headerPath.slice(0, tab);
    oldPath = headerPath.slice(tab + 1);
  } else if (headerPath) {
    newPath = headerPath;
    oldPath = parts[index + 1] ?? "";
    nextIndex = index + 1;
  } else {
    newPath = parts[index + 1] ?? "";
    oldPath = parts[index + 2] ?? "";
    nextIndex = index + 2;
  }
  return {
    nextIndex,
    file: {
      path: newPath,
      oldPath: oldPath || undefined,
      status: mapped.status === "modified" ? "renamed" : mapped.status,
      staged: mapped.staged,
    },
  };
}

function parseOrdinaryOrUnmerged(line: string): GitFileChange | undefined {
  // 1 XY sub mH mI mW hH hI path
  // u XY sub m1 m2 m3 mW h1 h2 h3 path
  const kind = line[0];
  const xy = line.slice(2, 4);
  const filePath = takePath(line, kind === "u" ? 10 : 8);
  if (!filePath) {
    return undefined;
  }
  if (kind === "u") {
    return {
      path: filePath,
      status: "conflict",
      staged: false,
      oursSide: conflictSide(xy[0] ?? "U"),
      theirsSide: conflictSide(xy[1] ?? "U"),
    };
  }
  return { path: filePath, ...mapXyToStatus(xy[0] ?? ".", xy[1] ?? ".") };
}

function conflictSide(letter: string): "modified" | "added" | "deleted" {
  if (letter === "A") {
    return "added";
  }
  if (letter === "D") {
    return "deleted";
  }
  return "modified";
}

function takePath(line: string, fieldCount: number): string {
  const index = findPathIndex(line, fieldCount);
  return index >= 0 ? line.slice(index) : "";
}

function findPathIndex(line: string, fieldCount: number): number {
  let seen = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === " ") {
      seen += 1;
      if (seen === fieldCount) {
        return i + 1;
      }
    }
  }
  return -1;
}

export interface RawCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
}

const UNIT = "\x1f";

export function parseLog(output: string): RawCommit[] {
  if (!output.trim()) {
    return [];
  }
  return output
    .split("\x1e")
    .map((block) => block.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((block) => {
      const [hash, parents, author, email, timestamp, subject, refs] = block.split(UNIT);
      return {
        hash: hash ?? "",
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        author: author ?? "",
        email: email ?? "",
        timestamp: Number(timestamp) || 0,
        subject: subject ?? "",
        refs: parseRefs(refs ?? ""),
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

export function parseRefs(decorate: string): string[] {
  if (!decorate.trim()) {
    return [];
  }
  return decorate
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const pointed = item.match(/^HEAD -> (.+)$/i);
      if (pointed?.[1]) {
        return ["HEAD", pointed[1]];
      }
      return [item];
    });
}

export function parseNameStatus(output: string): GitFileChange[] {
  if (!output.trim()) {
    return [];
  }
  if (output.includes("\0")) {
    return parseNameStatusZ(output);
  }
  return parseNameStatusPlain(output);
}

function parseNameStatusZ(output: string): GitFileChange[] {
  const lines = output.split("\0").filter(Boolean);
  const files: GitFileChange[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const statusToken = lines[i];
    if (!statusToken) {
      continue;
    }
    const code = statusToken[0] as string;
    const status = nameStatusToFile(code);
    if (code === "R" || code === "C") {
      const oldPath = lines[i + 1];
      const newPath = lines[i + 2];
      i += 2;
      files.push({ path: newPath ?? oldPath, oldPath, status, staged: false });
    } else {
      const filePath = lines[i + 1];
      i += 1;
      if (filePath) {
        files.push({ path: filePath, status, staged: false });
      }
    }
  }
  return files;
}

function parseNameStatusPlain(output: string): GitFileChange[] {
  const files: GitFileChange[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 2) {
      continue;
    }
    const code = (parts[0]?.[0] ?? "M") as string;
    const status = nameStatusToFile(code);
    if ((code === "R" || code === "C") && parts.length >= 3) {
      files.push({ path: parts[2] ?? parts[1], oldPath: parts[1], status, staged: false });
    } else if (parts[1]) {
      files.push({ path: parts[1], status, staged: false });
    }
  }
  return files;
}

function nameStatusToFile(code: string): FileStatus {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

export function parseBranches(output: string, current?: string): import("../ipc/protocol").GitBranch[] {
  const branches: import("../ipc/protocol").GitBranch[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [refname, shortName, head, upstream] = line.split("\x01");
    if (!refname || !shortName) {
      continue;
    }
    const remote = refname.startsWith("refs/remotes/");
    if (shortName.endsWith("/HEAD") || refname.endsWith("/HEAD")) {
      continue;
    }
    branches.push({
      name: shortName,
      fullName: shortName,
      current: head === "*" || shortName === current,
      remote,
      upstream: upstream || undefined,
      ahead: 0,
      behind: 0,
    });
  }
  return branches;
}

export function parseRemotes(output: string): import("../ipc/protocol").GitRemote[] {
  const map = new Map<string, import("../ipc/protocol").GitRemote>();
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
    if (!match) {
      continue;
    }
    const name = match[1] ?? "";
    const url = match[2] ?? "";
    const kind = match[3];
    const current = map.get(name) ?? { name, fetchUrl: url, active: false };
    if (kind === "fetch") {
      current.fetchUrl = url;
    } else {
      current.pushUrl = url;
    }
    map.set(name, current);
  }
  return [...map.values()];
}

export function parseStashList(output: string): import("../ipc/protocol").StashEntry[] {
  if (!output.trim()) {
    return [];
  }
  return output
    .trim()
    .split("\n")
    .map((line) => {
      const [name, timestamp, subject] = line.split("\x1f");
      const match = name?.match(/stash@\{(\d+)\}/);
      return {
        index: match ? Number(match[1]) : 0,
        name: name ?? "",
        subject: subject ?? "",
        timestamp: Number(timestamp) || 0,
        files: [],
      };
    });
}
