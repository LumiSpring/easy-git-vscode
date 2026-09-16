export function statusLetter(status: string): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "conflict":
      return "!";
    case "ignored":
      return "I";
    default:
      return "M";
  }
}

import { t } from "@i18n";

export function statusHint(status: string): string {
  switch (status) {
    case "modified":
      return t("status.modified");
    case "added":
      return t("status.added");
    case "deleted":
      return t("status.deleted");
    case "renamed":
      return t("status.renamed");
    case "copied":
      return t("status.copied");
    case "untracked":
      return t("status.untracked");
    case "conflict":
      return t("status.conflict");
    case "ignored":
      return t("status.ignored");
    default:
      return t("status.modified");
  }
}

export function formatMovedFrom(
  oldPath: string,
  modules: Array<{ path: string; name: string }> = [],
): string {
  const normalized = oldPath.replace(/\\/g, "/");
  const dir = dirName(normalized);
  const matched = [...modules]
    .filter((item) => item.path && (normalized === item.path || normalized.startsWith(`${item.path}/`)))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (matched) {
    return `moved from [${matched.name}] ${dir || matched.path}`;
  }
  return `moved from ${dir || normalized}`;
}

export function formatIdeaStamp(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `on ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} at ${date.getHours()}:${pad(date.getMinutes())}`;
}

export function formatTime(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp * (timestamp < 10_000_000_000 ? 1000 : 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatClock(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  }
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${seconds}s`;
}

export function fileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function dirName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}
