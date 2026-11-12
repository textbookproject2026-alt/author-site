// Test books, for the platform maintainer only (suggest-edit-function api/maintainer.js,
// through this site's /fn/maintainer/…). The server decides who may: these screens are
// drawn only when /api/me says is_maintainer, which is cosmetic; every request is checked.
//
//   #/new-test-book   a title, optional files (the portal form's picker: .docx or .md, at
//                     most five, 20 MB in all, each removable) and what it is. The book is
//                     built like any other and appears in "Your books", badged Test.
//   removeTestBook()  the book's Settings: "Remove test book", confirmed by typing its address.

import { h, clear, note, errorNote, plural } from "./dom.js";
import { maintainer } from "./api.js";
import { forgetBooks, myBooks } from "./books.js";
import { BOOK_TYPES } from "./booktype.js";
import { PART, readBase64 } from "./upload.js";

// The portal's request form, exactly (textbook-portal src/portal.js).
const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024;
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The first thing wrong with the chosen files, or null. */
export function filesProblem(files) {
  if (files.length > MAX_FILES) return "Please attach at most five files.";
  const bad = files.find((f) => !/\.(docx|md|markdown)$/i.test(f.name));
  if (bad) return `${bad.name} is not a Word (.docx) or Markdown (.md) file.`;
  const empty = files.find((f) => !f.size);
  if (empty) return `${empty.name} is empty.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES) return `The files come to ${sizeText(total)}, more than 20 MB. Remove some.`;
  return null;
}

// How long "Building" waits for the book to reach the list before saying so.
export const timing = { pollMs: 15_000, waitMs: 20 * 60_000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function newTestBookScreen() {
  const stage = h("div", { "aria-live": "polite" });
  const title = h("input", { type: "text", id: "tb-title", autocomplete: "off", required: true, maxlength: "200" });
  const type = h("select", { id: "tb-type" }, ...Object.entries(BOOK_TYPES).map(([value, label]) => h("option", { value, text: label })));
  const input = h("input", { type: "file", id: "tb-files", multiple: true, accept: ".docx,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown" });
  const list = h("ul", { class: "list" });
  const said = h("div");
  let picked = [];

  const draw = () => {
    clear(list, picked.map((file, i) => h("li", { class: "row" },
      h("span", { class: "grow", text: file.name }),
      h("span", { class: "muted small", text: sizeText(file.size) }),
      h("button", { type: "button", class: "btn link", text: "Remove", "aria-label": `Remove ${file.name}`, onclick: () => {
        picked.splice(i, 1);
        draw();
        (list.querySelector("button") ?? input).focus();
      } }))));
    const p = filesProblem(picked);
    clear(said, p ? note([h("p", { text: p })], "warn") : null);
  };
  input.addEventListener("change", () => {
    picked = [...picked, ...input.files];
    input.value = ""; // so the same file can be chosen again after removing it
    draw();
  });

  const form = h("form", {},
    h("label", { class: "field", for: "tb-title" }, "Title", title),
    h("label", { class: "field", for: "tb-type" }, "This is a…", type),
    h("label", { class: "field", for: "tb-files" }, "Files (optional): Word (.docx) or Markdown (.md), up to five, 20 MB in all", input),
    list,
    said,
    h("p", { class: "muted small", text: "Without files it starts from the template's front page and one blank chapter. Its address is test- and the title; it is unlisted, kept out of search engines, and says on every page that it will be removed." }),
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Create the test book" }), h("a", { class: "btn", href: "#/", text: "Cancel" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = title.value.replace(/\s+/g, " ").trim();
    if (name.length < 3) return clear(said, note([h("p", { text: "Give it a title of at least three characters." })], "warn"));
    const p = filesProblem(picked);
    if (p) return clear(said, note([h("p", { text: p })], "warn"));
    await create(stage, name, type.value, picked);
  });
  clear(stage, form);
  return [h("p", { class: "crumbs" }, h("a", { href: "#/", text: "Your books" })), h("h1", { text: "New test book" }), stage];
}

async function create(stage, title, contentType, files) {
  const bar = h("span");
  bar.style.width = "0%";
  const total = files.reduce((n, f) => n + f.size, 0);
  const line = h("p", { class: "busy", role: "status", text: files.length ? "Uploading files…" : "Setting up the test book…" });
  clear(stage, line, files.length ? h("div", { class: "progress", role: "progressbar", "aria-label": "Upload" }, bar) : null);
  let made;
  try {
    const sent = [];
    let done = 0;
    for (const file of files) {
      const entry = { name: file.name, parts: [] };
      for (let at = 0; at < file.size; at += PART) {
        const slice = file.slice(at, at + PART);
        entry.parts.push((await maintainer("test-books", { part: await readBase64(slice) })).sha);
        done += slice.size;
        bar.style.width = `${Math.round((done / total) * 100)}%`;
      }
      sent.push(entry);
    }
    line.textContent = "Setting up the test book…";
    made = await maintainer("test-books", { title, content_type: contentType, ...(sent.length ? { files: sent } : {}) });
  } catch (err) {
    clear(stage, errorNote(err), h("div", { class: "actions" },
      h("button", { type: "button", class: "btn", text: "Try again", onclick: () => window.dispatchEvent(new HashChangeEvent("hashchange")) }),
      h("a", { class: "btn", href: "#/", text: "Your books" })));
    return;
  }
  const site = `https://${made.slug}.confused4now.org/`;
  const waiting = h("p", { class: "busy", role: "status", text: "Building — usually ready in a few minutes." });
  clear(stage,
    note([h("p", {}, "Test book ", h("strong", { text: made.slug }), files.length ? ` asked for, with ${plural(files.length, "file")}.` : " asked for."), made.userMessage ? h("p", { text: made.userMessage }) : null]),
    waiting,
    h("p", { class: "muted small", text: `It will be at ${site} and in Your books, badged Test. You can leave this page: it carries on without it.` }));
  // The list says when it's there: the same list "Your books" reads.
  const began = Date.now();
  while (Date.now() - began < timing.waitMs) {
    await sleep(timing.pollMs);
    if (!stage.isConnected) return; // the maintainer moved on
    forgetBooks();
    const { books } = await myBooks().catch(() => ({ books: [] }));
    if (books.some((b) => b.slug === made.slug)) {
      clear(waiting, "Ready in the author site: ", h("a", { href: `#/${made.slug}`, text: "open it" }), ". Its site answers at ", h("a", { href: site, target: "_blank", rel: "noopener", text: site }), " once the first build is done.");
      waiting.className = "";
      return;
    }
  }
  waiting.className = "";
  waiting.textContent = "It's taking longer than usual. Nothing is lost: it will appear in Your books when it's ready.";
}

/** The book's Settings, for the maintainer on a test book: remove it, everything with it. */
export function removeTestBook(book) {
  const typed = h("input", { type: "text", id: "tb-remove-slug", autocomplete: "off", spellcheck: "false" });
  const go = h("button", { type: "button", class: "btn danger-solid", text: "Remove test book", disabled: true });
  const out = h("div", { "aria-live": "polite" });
  typed.addEventListener("input", () => {
    go.disabled = typed.value.trim() !== book.slug;
  });
  go.addEventListener("click", async () => {
    go.disabled = true;
    typed.disabled = true;
    clear(out, h("p", { class: "busy", role: "status", text: "Removing…" }));
    try {
      await maintainer(`test-books/${book.slug}/remove`, {});
      forgetBooks();
      clear(out, note([h("p", { text: "Removing it now: its site stops answering within a few minutes, and everyone on it has lost access already." }), h("p", {}, h("a", { href: "#/", text: "Back to your books" }))]));
    } catch (err) {
      go.disabled = false;
      typed.disabled = false;
      clear(out, errorNote(err));
    }
  });
  return [
    h("h2", { text: "Remove test book" }),
    h("p", { text: "Takes the test book down completely: its site, its repository, its registry entry, and everyone's access to it, with any invitations not yet used. It can't be undone." }),
    h("label", { class: "field", for: "tb-remove-slug" }, `Type ${book.slug} to confirm`, typed),
    h("div", { class: "actions" }, go),
    out,
  ];
}
