import type { MergeBlock, MergeChoice } from "../ipc/protocol";
import { t } from "../i18n";

export type { MergeBlock, MergeChoice };

export type DiffLine = { type: "equal" | "add" | "del"; text: string };

export function parseConflictFile(content: string): MergeBlock[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MergeBlock[] = [];
  let buffer: string[] = [];
  let index = 0;
  const flushText = () => {
    if (!buffer.length) {
      return;
    }
    blocks.push({ id: `t${index}`, kind: "text", text: buffer.join("\n") });
    index += 1;
    buffer = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("<<<<<<<")) {
      buffer.push(line);
      continue;
    }
    flushText();
    i += 1;
    const ours: string[] = [];
    while (i < lines.length && !/^(=======|\|\|\|\|\|\|\|)/.test(lines[i] ?? "")) {
      ours.push(lines[i] ?? "");
      i += 1;
    }
    const base: string[] = [];
    if ((lines[i] ?? "").startsWith("|||||||")) {
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("=======")) {
        base.push(lines[i] ?? "");
        i += 1;
      }
    }
    if ((lines[i] ?? "").startsWith("=======")) {
      i += 1;
    }
    const theirs: string[] = [];
    while (i < lines.length && !(lines[i] ?? "").startsWith(">>>>>>>")) {
      theirs.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({
      id: `c${index}`,
      kind: "conflict",
      ours: ours.join("\n"),
      theirs: theirs.join("\n"),
      ...(base.length ? { base: base.join("\n") } : {}),
    });
    index += 1;
  }
  flushText();
  return blocks;
}

export function hasConflictMarkers(content: string): boolean {
  return /^<<<<<<</m.test(content) && /^>>>>>>>/m.test(content);
}

export interface ConflictMarkerRange {
  ours: string;
  theirs: string;
  start: number;
  end: number;
}

export interface SideHunk {
  id: string;
  kind: MergeBlock["kind"];
  startLine: number;
  endLine: number;
}

export function findConflictMarkers(content: string): ConflictMarkerRange[] {
  const found: ConflictMarkerRange[] = [];
  let offset = 0;
  while (offset < content.length) {
    const line = readLine(content, offset);
    if (!line.text.startsWith("<<<<<<<")) {
      offset = line.next;
      continue;
    }
    const start = offset;
    offset = line.next;
    const ours: string[] = [];
    while (offset < content.length) {
      const current = readLine(content, offset);
      if (/^(=======|\|\|\|\|\|\|\|)/.test(current.text)) {
        break;
      }
      ours.push(current.text);
      offset = current.next;
    }
    if (readLine(content, offset).text.startsWith("|||||||")) {
      offset = readLine(content, offset).next;
      while (offset < content.length && !readLine(content, offset).text.startsWith("=======")) {
        offset = readLine(content, offset).next;
      }
    }
    if (readLine(content, offset).text.startsWith("=======")) {
      offset = readLine(content, offset).next;
    }
    const theirs: string[] = [];
    while (offset < content.length && !readLine(content, offset).text.startsWith(">>>>>>>")) {
      const current = readLine(content, offset);
      theirs.push(current.text);
      offset = current.next;
    }
    if (readLine(content, offset).text.startsWith(">>>>>>>")) {
      offset = readLine(content, offset).next;
    }
    found.push({
      ours: ours.join("\n"),
      theirs: theirs.join("\n"),
      start,
      end: offset,
    });
  }
  return found;
}

export function formatConflictMarker(ours: string, theirs: string, eol = "\n"): string {
  if (!ours && !theirs) {
    return "";
  }
  const oursBody = ours.length ? `${ours}${eol}` : "";
  const theirsBody = theirs.length ? `${theirs}${eol}` : "";
  return `<<<<<<< Yours${eol}${oursBody}=======${eol}${theirsBody}>>>>>>> Theirs${eol}`;
}

/** 6-char markers so VS Code/Cursor native merge UI does not attach. */
export const RESULT_OURS_MARK = "<<<<<< EasyGit Yours";
export const RESULT_SPLIT_MARK = "====== EasyGit";
export const RESULT_THEIRS_MARK = ">>>>>> EasyGit Theirs";

export function hasResultConflicts(content: string): boolean {
  return content.includes(RESULT_OURS_MARK) && content.includes(RESULT_THEIRS_MARK);
}

export function toGitConflictMarkers(content: string): string {
  if (!hasResultConflicts(content)) {
    return content;
  }
  return content
    .split(RESULT_OURS_MARK)
    .join("<<<<<<< Yours")
    .split(RESULT_SPLIT_MARK)
    .join("=======")
    .split(RESULT_THEIRS_MARK)
    .join(">>>>>>> Theirs");
}

export function formatResultConflict(ours: string, theirs: string, eol = "\n"): string {
  if (!ours && !theirs) {
    return "";
  }
  const oursBody = ours.length ? `${ours}${eol}` : "";
  const theirsBody = theirs.length ? `${theirs}${eol}` : "";
  return `${RESULT_OURS_MARK}${eol}${oursBody}${RESULT_SPLIT_MARK}${eol}${theirsBody}${RESULT_THEIRS_MARK}${eol}`;
}

export function findResultConflicts(content: string): ConflictMarkerRange[] {
  const found: ConflictMarkerRange[] = [];
  let offset = 0;
  while (offset < content.length) {
    const line = readLine(content, offset);
    if (!line.text.startsWith(RESULT_OURS_MARK)) {
      offset = line.next;
      continue;
    }
    const start = offset;
    offset = line.next;
    const ours: string[] = [];
    while (offset < content.length) {
      const current = readLine(content, offset);
      if (current.text.startsWith(RESULT_SPLIT_MARK)) {
        break;
      }
      ours.push(current.text);
      offset = current.next;
    }
    if (readLine(content, offset).text.startsWith(RESULT_SPLIT_MARK)) {
      offset = readLine(content, offset).next;
    }
    const theirs: string[] = [];
    while (offset < content.length && !readLine(content, offset).text.startsWith(RESULT_THEIRS_MARK)) {
      const current = readLine(content, offset);
      theirs.push(current.text);
      offset = current.next;
    }
    if (readLine(content, offset).text.startsWith(RESULT_THEIRS_MARK)) {
      offset = readLine(content, offset).next;
    }
    found.push({
      ours: ours.join("\n"),
      theirs: theirs.join("\n"),
      start,
      end: offset,
    });
  }
  return found;
}

export function buildResultDocument(blocks: MergeBlock[], eol = "\n"): string {
  return blocks
    .map((block) => {
      if (block.kind === "text" || block.kind === "ours" || block.kind === "theirs") {
        return block.text.replace(/\r?\n$/u, "");
      }
      return formatResultConflict(block.ours, block.theirs, eol).replace(/\r?\n$/u, "");
    })
    .filter((part) => part.length > 0)
    .join(eol);
}

export function sidePiece(block: MergeBlock, side: "ours" | "theirs"): string {
  if (block.kind === "text") {
    return block.text;
  }
  if (block.kind === "ours") {
    return side === "ours" ? block.text : block.base;
  }
  if (block.kind === "theirs") {
    return side === "theirs" ? block.text : block.base;
  }
  return side === "ours" ? block.ours : block.theirs;
}

export function buildSideDocument(blocks: MergeBlock[], side: "ours" | "theirs"): { content: string; hunks: SideHunk[] } {
  const parts: string[] = [];
  const hunks: SideHunk[] = [];
  let line = 0;
  for (const block of blocks) {
    const text = sidePiece(block, side);
    const startLine = line;
    if (text.length) {
      parts.push(text);
      line += splitLines(text).length;
    }
    if (block.kind !== "text") {
      hunks.push({
        id: block.id,
        kind: block.kind,
        startLine,
        endLine: Math.max(line, startLine + 1),
      });
    }
  }
  return { content: parts.join("\n"), hunks };
}

function readLine(content: string, offset: number): { text: string; next: number } {
  if (offset >= content.length) {
    return { text: "", next: offset };
  }
  const nl = content.indexOf("\n", offset);
  if (nl < 0) {
    return { text: content.slice(offset).replace(/\r$/, ""), next: content.length };
  }
  return { text: content.slice(offset, nl).replace(/\r$/, ""), next: nl + 1 };
}

export function applyMergeChoices(blocks: MergeBlock[], choices: MergeChoice[]): string {
  const map = new Map(choices.map((item) => [item.id, item]));
  return blocks
    .map((block) => {
      if (block.kind === "text") {
        return block.text;
      }
      if (block.kind === "ours" || block.kind === "theirs") {
        return block.text;
      }
      const picked = map.get(block.id);
      if (!picked) {
        throw new Error(t("error.unresolved"));
      }
      if (picked.choice === "ours") {
        return block.ours;
      }
      if (picked.choice === "theirs") {
        return block.theirs;
      }
      if (picked.choice === "both") {
        return [block.ours, block.theirs].filter((part) => part.length > 0).join("\n");
      }
      return picked.manual ?? "";
    })
    .join("\n");
}

export function unresolvedConflicts(blocks: MergeBlock[]): number {
  return blocks.filter((block) => block.kind === "conflict").length;
}

export function detectEol(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(from: string, to: string): DiffLine[] {
  const left = splitLines(from);
  const right = splitLines(to);
  const pairs = lcsPairs(left, right);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bi] of pairs) {
    while (i < ai) {
      out.push({ type: "del", text: left[i++] ?? "" });
    }
    while (j < bi) {
      out.push({ type: "add", text: right[j++] ?? "" });
    }
    out.push({ type: "equal", text: left[i] ?? "" });
    i += 1;
    j += 1;
  }
  while (i < left.length) {
    out.push({ type: "del", text: left[i++] ?? "" });
  }
  while (j < right.length) {
    out.push({ type: "add", text: right[j++] ?? "" });
  }
  return out;
}

export function threeWayMerge(base: string, ours: string, theirs: string): MergeBlock[] {
  const baseLines = splitLines(base);
  const oursLines = splitLines(ours);
  const theirsLines = splitLines(theirs);
  const oursAt = new Map(lcsPairs(baseLines, oursLines));
  const theirsAt = new Map(lcsPairs(baseLines, theirsLines));
  const sync = [...oursAt.keys()].filter((index) => theirsAt.has(index)).sort((left, right) => left - right);
  const raw: MergeBlock[] = [];
  let baseIndex = 0;
  let oursIndex = 0;
  let theirsIndex = 0;

  const flush = (baseEnd: number, oursEnd: number, theirsEnd: number) => {
    const baseText = baseLines.slice(baseIndex, baseEnd).join("\n");
    const oursText = oursLines.slice(oursIndex, oursEnd).join("\n");
    const theirsText = theirsLines.slice(theirsIndex, theirsEnd).join("\n");
    if (!baseText && !oursText && !theirsText) {
      return;
    }
    if (oursText === theirsText) {
      if (oursText.length > 0) {
        raw.push({ id: "", kind: "text", text: oursText });
      }
      return;
    }
    if (oursText === baseText) {
      raw.push({ id: "", kind: "theirs", text: theirsText, base: baseText });
      return;
    }
    if (theirsText === baseText) {
      raw.push({ id: "", kind: "ours", text: oursText, base: baseText });
      return;
    }
    raw.push({ id: "", kind: "conflict", ours: oursText, theirs: theirsText, base: baseText });
  };

  for (const baseSync of sync) {
    const oursSync = oursAt.get(baseSync);
    const theirsSync = theirsAt.get(baseSync);
    if (oursSync === undefined || theirsSync === undefined) {
      continue;
    }
    flush(baseSync, oursSync, theirsSync);
    raw.push({ id: "", kind: "text", text: baseLines[baseSync] ?? "" });
    baseIndex = baseSync + 1;
    oursIndex = oursSync + 1;
    theirsIndex = theirsSync + 1;
  }
  flush(baseLines.length, oursLines.length, theirsLines.length);

  const merged: MergeBlock[] = [];
  for (const block of raw) {
    const prev = merged[merged.length - 1];
    if (block.kind === "text" && prev?.kind === "text") {
      merged[merged.length - 1] = { id: "", kind: "text", text: `${prev.text}\n${block.text}` };
    } else {
      merged.push(block);
    }
  }
  return merged.map((block, index) => ({ ...block, id: `b${index}` }));
}

function lcsPairs(left: string[], right: string[]): Array<[number, number]> {
  const n = left.length;
  const m = right.length;
  if (!n || !m) {
    return [];
  }
  if (n * m > 2_000_000) {
    return greedyPairs(left, right);
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const current = dp[i];
    const next = dp[i + 1];
    if (!current || !next) {
      continue;
    }
    for (let j = m - 1; j >= 0; j -= 1) {
      current[j] = left[i] === right[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, current[j + 1] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

function greedyPairs(left: string[], right: string[]): Array<[number, number]> {
  const index = new Map<string, number[]>();
  for (let j = 0; j < right.length; j += 1) {
    const key = right[j] ?? "";
    const list = index.get(key) ?? [];
    list.push(j);
    index.set(key, list);
  }
  const pairs: Array<[number, number]> = [];
  let minJ = 0;
  for (let i = 0; i < left.length; i += 1) {
    const list = index.get(left[i] ?? "");
    if (!list) {
      continue;
    }
    const found = list.find((value) => value >= minJ);
    if (found === undefined) {
      continue;
    }
    pairs.push([i, found]);
    minJ = found + 1;
  }
  return pairs;
}
