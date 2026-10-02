// The signed-in author's books (the registry's `authors`, as the function reads it),
// fetched once per sign-in, and the screens' shared header for one book.

import { read } from "./api.js";
import { onChange } from "./auth.js";
import { h } from "./dom.js";

let books = null;
onChange(() => {
  books = null;
});

export function myBooks() {
  books ??= read("books").catch((err) => {
    books = null;
    throw err;
  });
  return books;
}

/** The book a route names, from the author's own list, or an error saying it isn't theirs. */
export async function bookBySlug(slug) {
  const { books: list } = await myBooks();
  const book = list.find((b) => b.slug === slug);
  if (!book) {
    const err = new Error("not yours");
    err.userMessage = "That book isn't one of yours, or it has been retired. Choose one from your books.";
    throw err;
  }
  return book;
}

/** "Your books › Title", the book's name, and its three tabs. */
export function bookHeader(book, current, title = book.title) {
  const tab = (key, href, text) => h("a", { href, text, "aria-current": key === current ? "page" : null });
  return [
    h("p", { class: "crumbs" }, h("a", { href: "#/", text: "Your books" }), " › ", current === "chapters" && title === book.title ? book.title : h("a", { href: `#/${book.slug}`, text: book.title })),
    h("h1", { text: title }),
    h("nav", { class: "tabs", "aria-label": "This book" },
      tab("chapters", `#/${book.slug}`, "Chapters"),
      tab("import", `#/${book.slug}/import`, "Bring in a Word document"),
      tab("waiting", `#/${book.slug}/waiting`, "Waiting for you")),
  ];
}

/** Where a page of the book is on a Quartz site (its slug: the path, .md dropped, spaces as dashes). */
export const pageSlug = (path) => path.replace(/\.md$/i, "").split("/").map((s) => encodeURIComponent(s.replace(/ /g, "-"))).join("/");

/** A file of the book on GitHub's public copy, at a commit. */
export const rawUrl = (repo, ref, path) => `https://raw.githubusercontent.com/${repo}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
