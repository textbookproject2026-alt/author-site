// Your books, a book's chapters, and one chapter as readers will see it.

import { h, busy, note, when } from "./dom.js";
import { read } from "./api.js";
import { bookBySlug, bookHeader, myBooks, pageSlug } from "./books.js";
import { renderChapter } from "./preview.js";
import { discussionUrl, draftsPreview, historyUrl, registryBook } from "./public.js";

export async function booksScreen() {
  const { login, books } = await myBooks();
  if (!books.length) {
    return [
      h("h1", { text: "Your books" }),
      note([
        h("p", {}, "You're signed in as ", h("strong", { text: `@${login}` }), ", but that account isn't one of any book's authors."),
        h("p", { text: "If a book was set up for you under a different GitHub account, sign out and sign in with that one. Otherwise, ask the platform's technical contact to add this account to your book." }),
      ]),
    ];
  }
  return [
    h("h1", { text: "Your books" }),
    h("ul", { class: "list" }, books.map((b) =>
      h("li", {},
        h("div", { class: "row" },
          h("div", { class: "grow" },
            h("h2", { class: "flush" }, h("a", { href: `#/${b.slug}`, text: b.title })),
            b.status === "preview" ? h("span", { class: "badge", text: "Preview: not listed for readers" }) : null,
            b.domain ? h("p", { class: "muted small below" }, h("a", { href: `https://${b.domain}/`, target: "_blank", rel: "noopener", text: b.domain })) : null),
          h("a", { class: "btn", href: `#/${b.slug}/waiting`, text: "Waiting for you" }))))),
  ];
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export async function chaptersScreen(slug) {
  const book = await bookBySlug(slug);
  const [tree, reg] = await Promise.all([read("tree", { book: slug }), registryBook(slug)]);
  const pages = tree.files.filter((f) => /\.md$/i.test(f.path));
  const chapters = pages.filter((f) => /^chapters\/[^/]+$/.test(f.path)).sort((a, b) => natural.compare(a.path, b.path));
  const folders = new Map();
  for (const f of pages.filter((p) => /^chapters\/.+\/.+$/.test(p.path))) {
    const folder = f.path.slice("chapters/".length, f.path.lastIndexOf("/"));
    folders.set(folder, [...(folders.get(folder) ?? []), f]);
  }
  const top = pages.filter((f) => f.path === "index.md" || f.path === "glossary.md");
  const link = (f, label) => h("li", {}, h("a", { href: `#/${slug}/chapter/${encodeURIComponent(f.path)}`, text: label ?? f.path.split("/").pop().replace(/\.md$/i, "") }));
  const preview = draftsPreview(reg);

  return [
    ...bookHeader(book, "chapters"),
    h("div", { class: "row" },
      h("a", { class: "btn", href: book.zip, download: "", text: "Download a copy" }),
      preview ? h("a", { class: "btn", href: preview, target: "_blank", rel: "noopener", text: "See the drafts preview" }) : null,
      h("a", { class: "btn link", href: historyUrl({ content: { repo: book.repo, live_branch: book.live_branch } }), target: "_blank", rel: "noopener", text: "History" }),
      discussionUrl(reg) ? h("a", { class: "btn link", href: discussionUrl(reg), target: "_blank", rel: "noopener", text: "Reader discussion" }) : null),
    h("p", { class: "muted small", text: "Download a copy is every file of the book as the drafts area holds it, in one .zip, from GitHub." }),
    h("h2", { text: "Chapters" }),
    chapters.length ? h("ul", { class: "list" }, chapters.map((f) => link(f))) : h("p", { class: "muted", text: "No chapters yet. Bring one in from a Word document." }),
    [...folders].map(([folder, list]) => [
      h("h3", { text: folder }),
      h("ul", { class: "list" }, list.sort((a, b) => natural.compare(a.path, b.path)).map((f) => link(f))),
    ]),
    top.length ? [h("h2", { text: "The rest of the book" }), h("ul", { class: "list" }, top.map((f) => link(f, f.path === "index.md" ? "Front page (index.md)" : "Glossary (glossary.md)")))] : null,
    note([
      h("p", {}, "A chapter that still lives in Word can be ", h("a", { href: `#/${slug}/import`, text: "brought in again" }), " to replace it."),
    ]),
  ];
}

export async function chapterScreen(slug, path) {
  const book = await bookBySlug(slug);
  const [tree, reg] = await Promise.all([read("tree", { book: slug }), registryBook(slug)]);
  const file = await read("file", { book: slug, path, ref: tree.head });
  const name = path.split("/").pop().replace(/\.md$/i, "");
  const raw = (p) => `https://raw.githubusercontent.com/${book.repo}/${tree.head}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const known = new Set(tree.files.map((f) => f.path));
  const shown = h("div", {}, busy("Formatting the chapter…"));
  if (typeof file.text === "string") {
    renderChapter(file.text, path, async (p) => (known.has(p) ? raw(p) : null)).then((node) => shown.replaceChildren(node));
  } else shown.replaceChildren(h("p", { class: "muted", text: "This file isn't text, so it can't be shown here." }));
  const preview = draftsPreview(reg);
  const slugPath = pageSlug(path === "index.md" ? "" : path);

  return [
    ...bookHeader(book, "chapters", name),
    h("p", { class: "muted small" }, h("code", { text: path }),
      file.last ? [" · last changed by ", h("strong", { text: file.last.who }), ` ${when(file.last.when)}`, file.last.message ? ` (“${file.last.message}”)` : ""] : null),
    h("div", { class: "row spaced" },
      /\.md$/i.test(path) && path.startsWith("chapters/") ? h("a", { class: "btn primary", href: `#/${slug}/tidy/${encodeURIComponent(path)}`, text: "Citations, concept links and glossary" }) : null,
      preview ? h("a", { class: "btn", href: `${preview}${slugPath}`, target: "_blank", rel: "noopener", text: "In the drafts preview" }) : null,
      book.domain ? h("a", { class: "btn", href: `https://${book.domain}/${slugPath}`, target: "_blank", rel: "noopener", text: "On the live site" }) : null),
    shown,
  ];
}
