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

test("review edits read as track changes: changes one word apart are one struck run and one inserted run", async () => {
  globalThis.document ??= { createTextNode: () => null }; // screens-review imports the DOM helpers; editRuns needs none
  const { editRuns } = await import("../site/lib/screens-review.js");
  assert.deepEqual(editRuns("Roots open channels in the ground, and worms", "Roots open channels that let air and water in, and worms"), [
    { eq: "Roots open channels " }, { del: "in the ground,", ins: "that let air and water in," }, { eq: " and worms" },
  ]);
  assert.deepEqual(editRuns("a b c d e", "a x c d y"), [{ eq: "a " }, { del: "b", ins: "x" }, { eq: " c d " }, { del: "e", ins: "y" }]);
});

test("forPreview drops a block id, never the line break or blank line after it (paragraphs stay apart)", async () => {
  globalThis.document ??= { createTextNode: () => null };
  const { forPreview } = await import("../site/lib/preview.js");
  assert.equal(forPreview("Bhaskar (1975). ^ref-bhaskar-1975\n\nBhaskar (1979). ^ref-b-1979\n"), "Bhaskar (1975).\n\nBhaskar (1979).\n");
  assert.equal(forPreview("they purport to measure. ^p-3\nBoth critiques"), "they purport to measure.\nBoth critiques");
});

test("an edit that is only a space or a line break still has runs to show", async () => {
  const { editRuns } = await import("../site/lib/screens-review.js");
  assert.deepEqual(editRuns("to measure. Both", "to measure.\n Both"), [{ eq: "to measure." }, { del: " ", ins: "\n " }, { eq: "Both" }]);
});
