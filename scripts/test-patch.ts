import { normalizeGitPatch, patchHasUnsafePaths, toRepoRelative } from "../src/git/patch";

const root = "e:\\project\\my\\git";

const relative = toRepoRelative(root, String.raw`e:\project\my\git\.idea\encodings.xml`);
if (relative !== ".idea/encodings.xml") {
  throw new Error(`expected relative path, got ${relative}`);
}

const patch = [
  String.raw`diff --git a/NUL b/e:\project\my\git\.idea\encodings.xml`,
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  String.raw`+++ b/e:\project\my\git\.idea\encodings.xml`,
  "@@ -0,0 +1,2 @@",
  "+<project>",
  "+</project>",
  "",
].join("\n");

const normalized = normalizeGitPatch(patch, root);
if (patchHasUnsafePaths(normalized)) {
  throw new Error(`normalized patch still unsafe:\n${normalized}`);
}
if (!normalized.includes("diff --git a/.idea/encodings.xml b/.idea/encodings.xml")) {
  throw new Error(`missing rewritten diff header:\n${normalized}`);
}
if (!normalized.includes("+++ b/.idea/encodings.xml")) {
  throw new Error(`missing rewritten +++ header:\n${normalized}`);
}
if (!normalized.includes("--- /dev/null")) {
  throw new Error("lost /dev/null header");
}

const quoted = normalizeGitPatch(
  String.raw`diff --git "a/e:\\project\\my\\git\\.idea\\misc.xml" "b/e:\\project\\my\\git\\.idea\\misc.xml"`,
  root,
);
if (!quoted.startsWith("diff --git a/.idea/misc.xml b/.idea/misc.xml")) {
  throw new Error(`quoted path rewrite failed:\n${quoted}`);
}

console.log("patch normalize ok");
