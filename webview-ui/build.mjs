import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@ipc": path.resolve(root, "../src/ipc/protocol.ts"),
  "@i18n": path.resolve(root, "../src/i18n/index.ts"),
};

function bundleName(name) {
  if (name === "EasyGitCommit") {
    return "commit";
  }
  if (name === "EasyGitMerge") {
    return "merge";
  }
  return "git-log";
}

async function bundle(entry, name, emptyOutDir) {
  const file = bundleName(name);
  await build({
    root,
    configFile: false,
    plugins: [react()],
    resolve: { alias },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    build: {
      outDir: path.resolve(root, "../dist/webview"),
      emptyOutDir,
      cssCodeSplit: false,
      sourcemap: false,
      minify: true,
      rollupOptions: {
        input: path.resolve(root, entry),
        output: {
          format: "iife",
          name,
          dir: path.resolve(root, "../dist/webview"),
          entryFileNames: `${file}.js`,
          assetFileNames: `${file}[extname]`,
          inlineDynamicImports: true,
        },
      },
    },
  });
}

await bundle("src/commit/main.tsx", "EasyGitCommit", true);
await bundle("src/git-log/main.tsx", "EasyGitLog", false);
await bundle("src/merge/main.tsx", "EasyGitMerge", false);
