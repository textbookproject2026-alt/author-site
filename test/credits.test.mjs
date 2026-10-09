import test from "node:test";
import assert from "node:assert/strict";
import { orcidOf, loginOf, peopleOf, problemsOf, peopleBlock, withPeople } from "../site/lib/credits.js";

test("ORCID iDs: the ISO 7064 11,2 check digit, bare or as an address", () => {
  assert.equal(orcidOf("0000-0002-1825-0097"), "0000-0002-1825-0097"); // ORCID's own example
  assert.equal(orcidOf("https://orcid.org/0000-0001-5109-3700"), "0000-0001-5109-3700");
  assert.equal(orcidOf("0000-0002-1694-233x"), "0000-0002-1694-233X"); // X as the check digit
  assert.equal(orcidOf("0000000218250097"), "0000-0002-1825-0097");
  assert.equal(orcidOf("0000-0002-1825-0098"), null); // wrong check digit
  assert.equal(orcidOf("0000-0002-1825"), null);
  assert.equal(orcidOf(""), null);
});

test("GitHub usernames and people", () => {
  assert.equal(loginOf("@gobi10k"), "gobi10k");
  assert.equal(loginOf("bad--name"), null);
  assert.deepEqual(peopleOf(["A", { name: "B", orcid: "0000-0002-1825-0097", github: "@bee" }, { name: "" }]), [
    { name: "A", orcid: "", github: "" },
    { name: "B", orcid: "0000-0002-1825-0097", github: "bee" },
  ]);
  assert.deepEqual(problemsOf([{ name: "", orcid: "", github: "" }, { name: "C", orcid: "0000-0002-1825-0098", github: "x y" }]), [
    "Person 1 has no name.",
    "C: “0000-0002-1825-0098” isn't an ORCID iD (it looks like 0000-0002-1825-0097, and its last digit is a check digit).",
    "C: “x y” isn't a GitHub username.",
  ]);
});

test("frontmatter: authors and editors replaced, every other line kept", () => {
  const page = '---\ntopic: "methods"\nauthors:\n  - "Brandon Sommer"\n  - "Caroline Laschkolnig"\nparagraphNumbers: true\n---\n\n# Title\n\nText.\n';
  assert.equal(
    withPeople(page, {
      authors: [{ name: "Brandon Sommer", orcid: "", github: "" }],
      editors: [{ name: "Ed Itor", orcid: "0000-0002-1825-0097", github: "ed-itor" }],
    }),
    '---\ntopic: "methods"\nparagraphNumbers: true\nauthors:\n  - "Brandon Sommer"\neditors:\n  - name: "Ed Itor"\n    orcid: "0000-0002-1825-0097"\n    github: "ed-itor"\n---\n\n# Title\n\nText.\n',
  );
  // No frontmatter: one is made. Empty lists: the keys go, and so does an empty block.
  assert.equal(withPeople("# T\n", { authors: [{ name: "A", orcid: "", github: "" }], editors: [] }), '---\nauthors:\n  - "A"\n---\n\n# T\n');
  assert.equal(withPeople('---\nauthors: [A, B]\n---\n\n# T\n', { authors: [], editors: [] }), "# T\n");
  assert.equal(withPeople("# T\n", { authors: [], editors: [] }), "# T\n");
  // CRLF stays CRLF; author:/editor: (singular) are replaced too.
  assert.equal(withPeople("---\r\nauthor: X\r\ntitle: T\r\n---\r\nBody\r\n", { authors: [{ name: "Y", orcid: "", github: "" }], editors: [] }), '---\r\ntitle: T\r\nauthors:\r\n  - "Y"\r\n---\r\nBody\r\n');
  assert.equal(peopleBlock("editors", [{ name: 'Quote "me"', orcid: "", github: "" }]), 'editors:\n  - "Quote \\"me\\""');
});
