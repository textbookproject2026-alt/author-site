// site/vendor/smartypants.js and its licences are exactly what scripts/vendor-smartypants.mjs
// writes from the pinned packages (the book site's versions), and the site's CSP is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, OUT, LICENSES } from "../scripts/vendor-smartypants.mjs";

test("the vendored typography module is the pinned packages' bundle, licences beside it", async () => {
  const { js, licenses } = await bundle();
  assert.ok(js === readFileSync(OUT, "utf8"), "site/vendor/smartypants.js is stale: run npm run vendor");
  assert.ok(licenses === readFileSync(LICENSES, "utf8"), "site/vendor/smartypants.LICENSES.txt is stale: run npm run vendor");
  for (const p of ["retext@9.0.0", "retext-smartypants@6.2.0", "unified@11.0.5", "parse-latin@7.0.0", "unist-util-visit@5.1.0", "vfile@6.0.3"]) assert.match(js, new RegExp(`^//   ${p.replace(/[.@]/g, "\\$&")} \\(MIT\\)$`, "m"), p);
});

test("the site's CSP loads scripts from this site, jsDelivr (questions, lint) and Plausible only", () => {
  const csp = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL("../site/_headers", import.meta.url), "utf8"))[1];
  assert.equal(/script-src ([^;]*)/.exec(csp)[1], "'self' https://cdn.jsdelivr.net https://plausible.io 'wasm-unsafe-eval'");
});
