// The comparison routine (site/lib/diff.js, a copy of the books' source.ts): unchanged
// paragraphs collapse, changed lines are paired and word-diffed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, pairRuns, unchangedLabel } from "../site/lib/diff.js";

test("a diff in unchanged paragraphs and changed runs, blank lines dropped", () => {
  const a = "One.\n\nTwo.\n\nThree here.\n\nFour.";
  assert.deepEqual(blocks(a, a.replace("here", "there")), [
    { same: ["One.", "Two."] },
    { ops: [{ t: "-", v: "Three here." }, { t: "+", v: "Three there." }] },
    { same: ["Four."] },
  ]);
  assert.deepEqual(blocks(a, a), []);
  assert.equal(unchangedLabel(1), "1 unchanged paragraph");
  assert.equal(unchangedLabel(2), "2 unchanged paragraphs");
});

test("removed and added lines paired, only the changed words marked, neighbours joined", () => {
  const [del, add, extra] = pairRuns([{ t: "-", v: "a b c" }, { t: "+", v: "a x y c" }, { t: "+", v: "New." }]);
  assert.deepEqual(del.words, [{ v: "a ", changed: false }, { v: "b", changed: true }, { v: " c", changed: false }]);
  assert.deepEqual(add.words, [{ v: "a ", changed: false }, { v: "x y", changed: true }, { v: " c", changed: false }]);
  assert.deepEqual(extra, { t: "+", words: [{ v: "New.", changed: true }] });
});
