// site/vendor/ is exactly what scripts/vendor.mjs writes from the pinned packages (the
// typography, markdownlint, js-yaml, Pyodide), every output with its licences, and the
// site's CSP lets scripts come from this site and Plausible only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BUNDLES, PYODIDE, target, vendored } from "../scripts/vendor.mjs";

test("every vendored file is the build of the pinned packages, licences beside each", async () => {
  const files = await vendored();
  for (const f of files) assert.ok(f.data.equals(readFileSync(target(f.path))), `site/vendor/${f.path} is stale: run npm run vendor`);
  // Nothing else in site/vendor/ (a file no build writes would be served unchecked).
  const on = (dir) => readdirSync(target(dir)).filter((n) => !n.startsWith(".")).map((n) => dir + n);
  const disk = [...on(""), ...on(PYODIDE.dir)].filter((p) => p !== PYODIDE.dir.slice(0, -1)).sort();
  assert.deepEqual(disk, files.map((f) => f.path).sort());
  for (const name of Object.keys(BUNDLES)) assert.ok(files.some((f) => f.path === name.replace(/\.js$/, ".LICENSES.txt")), `${name}: licences`);
  assert.ok(files.some((f) => f.path === `${PYODIDE.dir}LICENSES.txt`));
  // The versions pinned, as each bundle's header lists them.
  const text = (p) => files.find((f) => f.path === p).data.toString("utf8");
  for (const [p, want] of [["smartypants.js", ["retext@9.0.0", "retext-smartypants@6.2.0", "unified@11.0.5", "parse-latin@7.0.0"]], ["markdownlint.js", ["markdownlint@0.38.0"]], ["js-yaml.js", ["js-yaml@4.1.0"]]]) {
    for (const v of want) assert.match(text(p), new RegExp(`^//   ${v.replace(/[.@]/g, "\\$&")} \\(`, "m"), `${p}: ${v}`);
  }
  assert.match(text(`${PYODIDE.dir}LICENSES.txt`), /^pyodide@314\.0\.7 /);
});

test("the CSP: scripts from this site and Plausible only (no CDN), WebAssembly allowed for Pyodide", () => {
  const csp = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../site/_headers", import.meta.url), "utf8"))[1];
  const sources = /script-src ([^;]*)/.exec(csp)[1].split(/\s+/);
  // Origins: exactly 'self' and Plausible. 'wasm-unsafe-eval' is a keyword, not an origin: Pyodide's WebAssembly.
  assert.deepEqual(sources.filter((s) => s !== "'wasm-unsafe-eval'"), ["'self'", "https://plausible.io"]);
  assert.doesNotMatch(csp, /jsdelivr/);
});
