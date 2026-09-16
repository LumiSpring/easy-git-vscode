import { buildCommitGraph } from "../src/git/graph";
import type { RawCommit } from "../src/git/parsers";

function commit(hash: string, parents: string[], subject: string, refs: string[] = []): RawCommit {
  return { hash, parents, author: "t", email: "t", timestamp: 0, subject, refs };
}

const nodes = buildCommitGraph([
  commit("D", ["E", "G"], "Merge cmc-dev", ["HEAD -> master"]),
  commit("G", ["H"], "loginService2"),
  commit("E", ["H", "F"], "Merge master"),
  commit("F", ["H"], "update main3"),
  commit("H", ["I"], "feat loginService"),
  commit("I", [], "first"),
]);

for (const node of nodes) {
  const lines = node.lines.map((line) => `${line.span}:${line.from}->${line.to}`).join(" ");
  console.log(`${node.subject.padEnd(20)} lane=${node.lane} in=${node.incoming} merge=${node.isMerge} ${lines}`);
}

const d = nodes[0];
const g = nodes[1];
const e = nodes[2];
const f = nodes[3];
const h = nodes[4];
if (d?.lane !== 0 || !d.isMerge) {
  throw new Error("D should be merge on lane 0");
}
if (g?.lane !== 1) {
  throw new Error(`G should be on lane 1, got ${g?.lane}`);
}
if (e?.lane !== 0 || !e.isMerge) {
  throw new Error("E should be merge on lane 0");
}
if (f?.lane !== 2) {
  throw new Error(`F should be on lane 2, got ${f?.lane}`);
}
if (!f.lines.some((line) => line.span === "down" && line.from === 2)) {
  throw new Error("F should continue its lane downward");
}
if (h?.lane !== 0) {
  throw new Error(`H should return to lane 0, got ${h?.lane}`);
}
console.log("graph ok");
