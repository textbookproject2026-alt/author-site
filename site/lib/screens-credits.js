// Credits: who is named as the book's authors and editors, and a chapter's own
// (which override the book's for that chapter). Each person has a name and,
// optionally, an ORCID iD (checked by its check digit) and a GitHub username. The
// ORCID field shows only while the platform has ORCID on (registry
// platform.features.orcid); while it is off, iDs already in the frontmatter are kept
// as they are and saved back unchanged, just not shown. Saving
// is one change on the drafts, like any other: readers see it when the book is
// published. The frontmatter keys are quartz-book's (credits.js); contributors are
// credited by the platform from accepted edits and notes, not here.

import { h, clear, busy, note, errorNote } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader } from "./books.js";
import { forgetCount, titlesFrom } from "./drafts.js";
import { peopleOf, problemsOf, withPeople } from "./credits.js";
import { platformFeatures } from "./public.js";

const JS_YAML = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
let yamlLib = null;
const yaml = () => (yamlLib ??= import(JS_YAML));

/** A page's frontmatter, parsed; {} when it has none or it doesn't parse. */
async function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? "");
  if (!m) return {};
  try {
    const fm = (await yaml()).load(m[1]);
    return fm && typeof fm === "object" && !Array.isArray(fm) ? fm : {};
  } catch {
    return {};
  }
}

const isChapter = (path) => /^chapters\/.+\.md$/i.test(path);

export async function creditsScreen(slug, path = "") {
  const book = await bookBySlug(slug);
  const stage = h("div", { "aria-live": "polite" });
  await draw(book, stage, path);
  return [...bookHeader(book, "credits", "Credits"), stage];
}

async function draw(book, stage, path, said = null) {
  clear(stage, busy("Reading the book…"));
  const tree = await read("tree", { book: book.slug });
  const chapters = tree.files.map((f) => f.path).filter(isChapter).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const target = path && chapters.includes(path) ? path : "index.md";
  const file = await read("file", { book: book.slug, path: target, ref: tree.head }).catch(() => null);
  const text = typeof file?.text === "string" ? file.text : "";
  const fm = await frontmatter(text);
  const index = target === "index.md" ? null : await read("file", { book: book.slug, path: "index.md", ref: tree.head }).catch(() => null);
  const titles = titlesFrom(index?.text ?? text);
  const bookFm = target === "index.md" ? fm : await frontmatter(index?.text ?? "");

  const lists = { authors: peopleOf(fm.authors ?? fm.author), editors: peopleOf(fm.editors ?? fm.editor) };
  const orcidOn = (await platformFeatures()).orcid !== false;
  const out = h("div", { "aria-live": "polite" });

  const editor = (key, label, help) => {
    const ul = h("ol", { class: "credit-list" });
    const redraw = () => {
      clear(ul, ...lists[key].map((p, i) => {
        const name = h("input", { type: "text", value: p.name, "aria-label": `${label} ${i + 1}: name`, autocomplete: "off" });
        const orcid = h("input", { type: "text", value: p.orcid, placeholder: "ORCID iD (optional)", "aria-label": `${label} ${i + 1}: ORCID iD`, autocomplete: "off", spellcheck: "false" });
        const github = h("input", { type: "text", value: p.github, placeholder: "GitHub username (optional)", "aria-label": `${label} ${i + 1}: GitHub username`, autocomplete: "off", spellcheck: "false" });
        name.addEventListener("input", () => (p.name = name.value));
        orcid.addEventListener("input", () => (p.orcid = orcid.value));
        github.addEventListener("input", () => (p.github = github.value));
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= lists[key].length) return;
          [lists[key][i], lists[key][j]] = [lists[key][j], lists[key][i]];
          redraw();
        };
        return h("li", { class: "credit-row" },
          h("div", { class: "credit-fields" }, name, orcidOn ? orcid : null, github),
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn link", text: "Up", disabled: i === 0, onclick: () => move(-1) }),
            h("button", { type: "button", class: "btn link", text: "Down", disabled: i === lists[key].length - 1, onclick: () => move(1) }),
            h("button", { type: "button", class: "btn link", text: "Remove", onclick: () => { lists[key].splice(i, 1); redraw(); } })));
      }));
      if (!lists[key].length) ul.append(h("li", { class: "muted", text: "Nobody yet." }));
    };
    redraw();
    const add = h("button", { type: "button", class: "btn", text: `Add ${label.toLowerCase()}`, onclick: () => { lists[key].push({ name: "", orcid: "", github: "" }); redraw(); ul.querySelector("li:last-child input")?.focus(); } });
    return h("section", {}, h("h2", { text: `${label}s` }), h("p", { class: "muted", text: help }), ul, add);
  };

  const save = h("button", { type: "button", class: "btn primary", text: "Save to the drafts" });
  save.addEventListener("click", async () => {
    const people = { authors: lists.authors.filter((p) => p.name.trim() || p.orcid.trim() || p.github.trim()), editors: lists.editors.filter((p) => p.name.trim() || p.orcid.trim() || p.github.trim()) };
    const problems = [...problemsOf(people.authors), ...problemsOf(people.editors)];
    if (problems.length) return clear(out, note(problems.map((p) => h("p", { text: p })), "warn"));
    const next = withPeople(text, people);
    if (next === text) return clear(out, note([h("p", { text: "Nothing has changed." })]));
    save.disabled = true;
    clear(out, busy("Saving…"));
    try {
      await send({ book: book.slug, base: tree.head, files: [{ path: target, text: next }], message: target === "index.md" ? "Credits: the book's authors and editors" : `Credits: authors and editors of “${titles.get(target) ?? target}”` });
      forgetCount(book.slug);
      await draw(book, stage, path, note([h("p", { text: "Saved to the drafts. Readers see it when you publish." })]));
    } catch (err) {
      save.disabled = false;
      clear(out, errorNote(err));
    }
  });

  const pick = h("select", { id: "credits-page" },
    h("option", { value: "", text: "The whole book", selected: target === "index.md" }),
    ...chapters.map((c) => h("option", { value: c, text: titles.get(c) ?? c, selected: c === target })));
  pick.addEventListener("change", () => { location.hash = `#/${book.slug}/credits${pick.value ? `/${encodeURIComponent(pick.value)}` : ""}`; });

  const bookNames = (k) => peopleOf(bookFm[k]).map((p) => p.name).join(", ") || "nobody";
  clear(stage,
    said,
    h("p", { text: "Authors and editors are named on the pages and in every citation. Contributors (readers whose edits and notes you accept) are credited by the platform on its own." }),
    h("label", { class: "field", for: "credits-page" }, "Credits for", pick),
    target === "index.md"
      ? null
      : note([h("p", { text: `A chapter's own authors and editors replace the book's for that chapter. Leave a list empty to use the book's (authors: ${bookNames("authors")}; editors: ${bookNames("editors")}).` })]),
    editor("authors", "Author", target === "index.md" ? "Who wrote the book, in the order they are cited." : "Who wrote this chapter, in the order they are cited."),
    editor("editors", "Editor", target === "index.md" ? "Who edited the book. A book with editors and no authors is cited as an edited volume (Ed./Eds.)." : "Who edited this chapter, if not the book's editors."),
    h("div", { class: "actions" }, save),
    out);
}
