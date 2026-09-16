import { applyMergeChoices, buildResultDocument, diffLines, findConflictMarkers, findResultConflicts, formatResultConflict, hasConflictMarkers, hasResultConflicts, parseConflictFile, threeWayMerge, toGitConflictMarkers, unresolvedConflicts } from "../src/git/conflicts";

const simple = `keep
<<<<<<< HEAD
ours line
=======
theirs line
>>>>>>> feature
tail
`;

const blocks = parseConflictFile(simple);
if (blocks.length !== 3) {
  throw new Error(`expected 3 blocks, got ${blocks.length}`);
}
if (blocks[0]?.kind !== "text" || blocks[0].text !== "keep") {
  throw new Error("leading text mismatch");
}
if (blocks[1]?.kind !== "conflict" || blocks[1].ours !== "ours line" || blocks[1].theirs !== "theirs line") {
  throw new Error("conflict sides mismatch");
}
if (blocks[2]?.kind !== "text" || blocks[2].text !== "tail\n") {
  throw new Error(`trailing text mismatch: ${JSON.stringify(blocks[2])}`);
}

const diff3 = `<<<<<<< HEAD
ours
||||||| merged common ancestors
base
=======
theirs
>>>>>>> other
`;
const diff3Blocks = parseConflictFile(diff3);
const conflict = diff3Blocks.find((block) => block.kind === "conflict");
if (!conflict || conflict.kind !== "conflict" || conflict.ours !== "ours" || conflict.theirs !== "theirs" || conflict.base !== "base") {
  throw new Error("diff3 parse failed");
}

const equalsOnly = `<<<<<<< HEAD
a
=======
b
>>>>>>> x
`;
const equalsConflict = parseConflictFile(equalsOnly).find((block) => block.kind === "conflict");
if (!equalsConflict || equalsConflict.kind !== "conflict" || equalsConflict.ours !== "a" || equalsConflict.theirs !== "b") {
  throw new Error("======= line should parse without word boundary");
}
if (!hasConflictMarkers(simple) || hasConflictMarkers("no markers")) {
  throw new Error("marker detection failed");
}

const resolved = applyMergeChoices(blocks, [{ id: blocks[1]?.id ?? "", choice: "theirs" }]);
if (resolved !== "keep\ntheirs line\ntail\n") {
  throw new Error(`apply mismatch: ${JSON.stringify(resolved)}`);
}
if (unresolvedConflicts(blocks) !== 1) {
  throw new Error("unresolved count failed");
}

try {
  applyMergeChoices(blocks, []);
  throw new Error("should reject unresolved");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "还有未解决的冲突") {
    throw error;
  }
}

const merged = threeWayMerge("line1\nline2\nline3", "line1\nours2\nline3", "line1\ntheirs2\nline3");
const kinds = merged.map((block) => block.kind).join(",");
if (kinds !== "text,conflict,text") {
  throw new Error(`three-way kinds ${kinds}`);
}
const hunk = merged[1];
if (!hunk || hunk.kind !== "conflict" || hunk.ours !== "ours2" || hunk.theirs !== "theirs2") {
  throw new Error(`three-way conflict ${JSON.stringify(hunk)}`);
}

const oursOnly = threeWayMerge("a\nb\nc", "a\nours\nc", "a\nb\nc");
if (oursOnly.map((block) => block.kind).join(",") !== "text,ours,text") {
  throw new Error(`ours-only ${oursOnly.map((block) => block.kind).join(",")}`);
}

const lineDiff = diffLines("keep\nold", "keep\nnew");
if (lineDiff.map((line) => line.type).join(",") !== "equal,del,add") {
  throw new Error(`diff ${JSON.stringify(lineDiff)}`);
}

const markers = findConflictMarkers(simple);
if (markers.length !== 1 || markers[0]?.ours !== "ours line" || markers[0]?.theirs !== "theirs line") {
  throw new Error(`marker ranges ${JSON.stringify(markers)}`);
}
const afterAccept = `${simple.slice(0, markers[0]?.start ?? 0)}theirs line\n${simple.slice(markers[0]?.end ?? 0)}`;
if (hasConflictMarkers(afterAccept) || !afterAccept.includes("theirs line")) {
  throw new Error(`replace failed ${JSON.stringify(afterAccept)}`);
}

const resultText = formatResultConflict("ours line", "theirs line");
if (hasConflictMarkers(resultText)) {
  throw new Error("result markers must not look like git conflict markers");
}
if (!hasResultConflicts(resultText)) {
  throw new Error("result conflict not detected");
}
const resultMarkers = findResultConflicts(resultText);
if (resultMarkers.length !== 1 || resultMarkers[0]?.ours !== "ours line" || resultMarkers[0]?.theirs !== "theirs line") {
  throw new Error(`result marker ranges ${JSON.stringify(resultMarkers)}`);
}
const built = buildResultDocument(blocks);
if (hasConflictMarkers(built) || !hasResultConflicts(built) || !built.includes("ours line")) {
  throw new Error(`buildResultDocument failed ${JSON.stringify(built)}`);
}
const restored = toGitConflictMarkers(built);
if (!hasConflictMarkers(restored) || hasResultConflicts(restored) || !restored.includes("ours line")) {
  throw new Error(`toGitConflictMarkers failed ${JSON.stringify(restored)}`);
}

console.log("conflicts parser ok");
