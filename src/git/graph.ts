import type { GitCommitNode, GraphLine } from "../ipc/protocol";
import type { RawCommit } from "./parsers";

function firstEmpty(reserved: Array<string | null>): number {
  const index = reserved.indexOf(null);
  return index === -1 ? reserved.length : index;
}

function ensureLane(reserved: Array<string | null>, lane: number): void {
  while (reserved.length <= lane) {
    reserved.push(null);
  }
}

function placeNewOrExisting(reserved: Array<string | null>, hash: string): number {
  const existing = reserved.indexOf(hash);
  if (existing !== -1) {
    return existing;
  }
  const lane = firstEmpty(reserved);
  ensureLane(reserved, lane);
  reserved[lane] = hash;
  return lane;
}

export function buildCommitGraph(raw: RawCommit[]): GitCommitNode[] {
  const reserved: Array<string | null> = [];
  const nodes: GitCommitNode[] = [];

  for (const commit of raw) {
    const waiting: number[] = [];
    for (let i = 0; i < reserved.length; i += 1) {
      if (reserved[i] === commit.hash) {
        waiting.push(i);
      }
    }

    const incoming = waiting.length > 0;
    const lane = waiting[0] ?? firstEmpty(reserved);
    ensureLane(reserved, lane);
    reserved[lane] = commit.hash;

    const top = reserved.slice();

    for (const index of waiting.length > 0 ? waiting : [lane]) {
      reserved[index] = null;
    }

    const parentLanes: number[] = [];
    for (let i = 0; i < commit.parents.length; i += 1) {
      const parent = commit.parents[i];
      if (i === 0) {
        ensureLane(reserved, lane);
        reserved[lane] = parent;
        parentLanes.push(lane);
      } else {
        parentLanes.push(placeNewOrExisting(reserved, parent));
      }
    }

    while (reserved.length > 0 && reserved[reserved.length - 1] == null) {
      reserved.pop();
    }

    const lines: GraphLine[] = [];
    const seenThrough = new Set<number>();
    const width = Math.max(top.length, reserved.length, lane + 1);

    for (let i = 0; i < width; i += 1) {
      const topHash = top[i];
      if (!topHash || topHash === commit.hash) {
        continue;
      }
      const bottomLane = reserved[i] === topHash ? i : reserved.indexOf(topHash);
      if (bottomLane === -1 || seenThrough.has(i)) {
        continue;
      }
      seenThrough.add(i);
      lines.push({ from: i, to: bottomLane, color: i, span: "full" });
    }

    for (const fromLane of waiting.slice(1)) {
      lines.push({ from: fromLane, to: lane, color: fromLane, span: "in" });
    }

    const seenDown = new Set<number>();
    for (const parentLane of parentLanes) {
      if (seenDown.has(parentLane)) {
        continue;
      }
      seenDown.add(parentLane);
      const color = parentLane > lane ? parentLane : lane;
      lines.push({ from: lane, to: parentLane, color, span: "down" });
    }

    const laneCount = Math.max(1, width, ...lines.flatMap((line) => [line.from + 1, line.to + 1]));
    nodes.push({
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      parents: commit.parents,
      author: commit.author,
      email: commit.email,
      timestamp: commit.timestamp,
      subject: commit.subject,
      refs: commit.refs,
      lane,
      laneCount,
      incoming,
      isMerge: commit.parents.length > 1,
      isHead: commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD")),
      lines,
    });
  }

  return nodes;
}
