import esbuild from "esbuild";
import builtinModules from "builtin-modules";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const root = process.cwd();
const dist = join(root, "dist");
const stylesDir = join(root, "src", "styles");
const staticFiles = ["manifest.json", "README.md"];

function buildStyles() {
  mkdirSync(dist, { recursive: true });

  const styleFiles = readFileSync(join(root, "styles.css"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^@import url\("\.\/src\/styles\/([^"]+\.css)"\);$/)?.[1])
    .filter(Boolean);

  const styles = styleFiles
    .map((file) => readFileSync(join(stylesDir, file), "utf8").trim())
    .join("\n\n");

  writeFileSync(join(dist, "styles.css"), `${styles}\n`);
}

function copyStaticFiles() {
  mkdirSync(dist, { recursive: true });

  for (const file of staticFiles) {
    copyFileSync(join(root, file), join(dist, file));
  }
}

buildStyles();
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
