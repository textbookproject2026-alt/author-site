// The review's paragraph edits (site/lib/review-edits.js): what the editor starts from, the
// chapter they make with the ticked edits, and finding them again when the drafts moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { covers, prefill, rangeFor, reanchor, resultOf } from "../site/lib/review-edits.js";

const P = ["# Title\n\n", "One a.\n", "One b.\n\n", "Two.\n\n", "Three.\n"];

test("the editor starts from the paragraph with its ticked edits; an edit crossing its edge widens it", () => {
  assert.equal(prefill(P, 1, 3, [{ at: 2, end: 3, to: "One B!\n\n" }]), "One a.\nOne B!");
  assert.deepEqual(rangeFor([{ at: 2, end: 4 }], 1, 3), { lo: 1, hi: 4 });
  assert.ok(covers({ lo: 1, hi: 3 }, { at: 2, end: 3 }));
  assert.ok(!covers({ lo: 3, hi: 3 }, { at: 3, end: 4 }), "a new paragraph covers nothing");
});

test("the chapter as it will be saved: ticked edits outside the author's, the author's, a new paragraph; its lines", () => {
  const ticked = [{ at: 3, end: 4, to: "Two!\n\n" }, { at: 2, end: 3, to: "inside\n\n" }];
  const edits = [{ lo: 1, hi: 3, text: "One, rewritten." }, { lo: 5, hi: 5, text: "Four." }];
  const r = resultOf(P, ticked, edits);
  assert.equal(r.text, "# Title\n\nOne, rewritten.\n\nTwo!\n\nThree.\n\nFour.\n");
  assert.deepEqual(r.lines.get("1_3"), [3, 3]);
  assert.deepEqual(r.lines.get("5_5"), [8, 9], "with the blank line it adds");
});

test("the drafts moved: an edit goes where its paragraph is now; one whose paragraph changed is kept aside", () => {
  const now = ["# Title\n\n", "New first.\n\n", "One a.\n", "One b.\n\n", "Two, changed.\n\n", "Three.\n"];
  const { kept, lost } = reanchor(now, [
    { lo: 1, hi: 3, orig: "One a.\nOne b.\n\n", text: "x" },
    { lo: 3, hi: 4, orig: "Two.\n\n", text: "y" },
    { lo: 4, hi: 4, after: "Two.\n\n", afterN: 1, text: "z" },
    { lo: 5, hi: 5, after: "Three.\n", afterN: 1, text: "w" },
  ]);
  assert.deepEqual(kept.map((e) => [e.lo, e.hi, e.text]), [[2, 4, "x"], [6, 6, "w"]]);
  assert.deepEqual(lost.map((e) => e.text), ["y", "z"]);
});
