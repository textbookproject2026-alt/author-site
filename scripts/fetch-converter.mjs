#!/usr/bin/env node
// The Pages build step: copy the Authoring Assistant's Python (converter.json's files,
// at its pinned commit) into site/py/, for the questions to run in the browser.
//
//   node scripts/fetch-converter.mjs                      from GitHub, at converter.json's ref
//   CONVERTER_DIR=../authoring-assistant node scripts/…   from a local checkout, as it is (tests)
//
// A file that can't be fetched fails the build, so a deploy never goes out with the
// questions half there. Plain Node, no dependencies (Pages' build image has Node).
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "py");
const pin = JSON.parse(readFileSync(join(ROOT, "converter.json"), "utf8"));
if (!/^[0-9a-f]{40}$/.test(pin.ref)) throw new Error("converter.json: ref must be a full commit SHA");

rmSync(OUT, { recursive: true, force: true });
const local = process.env.CONVERTER_DIR;
for (const file of pin.files) {
  let text;
  if (local) text = readFileSync(join(local, file), "utf8");
  else {
    const url = `https://raw.githubusercontent.com/${pin.repo}/${pin.ref}/${file}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`fetch-converter: ${url} answered ${res.status}${res.status === 404 ? " (is authoring-assistant public?)" : ""}`);
      process.exit(1);
    }
    text = await res.text();
  }
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  writeFileSync(join(OUT, file), text);
}
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify({ repo: pin.repo, ref: local ? `local:${local}` : pin.ref, files: pin.files, pyodide: pin.pyodide }, null, 2)}\n`);
console.log(`fetch-converter: ${pin.files.length} files from ${local ? local : `${pin.repo}@${pin.ref.slice(0, 7)}`} into site/py/`);
