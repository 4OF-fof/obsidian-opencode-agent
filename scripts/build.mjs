import esbuild from "esbuild";
import builtinModules from "builtin-modules";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const root = process.cwd();
const dist = join(root, "dist");
const staticFiles = ["manifest.json", "styles.css", "README.md"];

function copyStaticFiles() {
  mkdirSync(dist, { recursive: true });

  for (const file of staticFiles) {
    copyFileSync(join(root, file), join(dist, file));
  }
}

copyStaticFiles();

const buildOptions = {
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    ...builtinModules,
  ],
  format: "cjs",
  logLevel: "info",
  outfile: "dist/main.js",
  platform: "node",
  sourcemap: "inline",
  target: "es2022",
};

if (watch) {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
