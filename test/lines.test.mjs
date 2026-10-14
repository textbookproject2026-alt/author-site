// screens-shared.js lineSpan on its own (no browser): a lint problem's line number, as
// markdownlint 0.38.0 gives it, to the place in the editor's text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lineSpan } from "../site/lib/screens-shared.js";

// markdownlint counts the front matter's lines: on this page it reports MD018 at line 10
// and MD034 at line 12 (checked against markdownlint 0.38.0, the books' version).
const PAGE = '---\ntitle: "T"\nauthors: [a]\n---\n\n# Title\n\nPara one.\n\n##Bad heading\n\nlast para http://x.com\n';
const at = (text, n) => text.slice(...lineSpan(text, n));

test("a line number counts the front matter, as markdownlint does", () => {
  assert.equal(at(PAGE, 1), "---");
  assert.equal(at(PAGE, 10), "##Bad heading");
  assert.equal(at(PAGE, 12), "last para http://x.com");
});

test("a whole paragraph is one line, however long", () => {
  const long = "word ".repeat(400).trim();
  const text = `# A\n\n${long}\n\nEnd`;
  assert.equal(at(text, 3), long);
  assert.equal(at(text, 5), "End");
  assert.deepEqual(lineSpan(text, 5), [text.length - 3, text.length]);
});

test("lines past either end go to the nearest; an empty page has line 1", () => {
  assert.equal(at(PAGE, 0), "---");
  assert.equal(at(PAGE, 999), "");
  assert.equal(at("# A\nB", 999), "B");
  assert.deepEqual(lineSpan("", 3), [0, 0]);
});
