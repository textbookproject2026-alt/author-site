// Editing a page of the book: the books' in-site editor (quartz-edition-extras
// edit-on-github editor.ts) laid out as a screen of this site: Edit | Preview |
// Changes. There is no Send: the text is saved to the drafts as the author types
// (a second and a half after they stop, and at most every 20 seconds while they
// keep going), each save one change made by them through author-send, and the line
// under the title says so: "Saving…", "Draft saved 14:32", or what went wrong.
//
// Links & glossary (beside Done) saves what is typed, then opens the chapter's
// citation, concept-link, glossary and AI formatting questions (screens-tidy.js).
//
// The book's own lint runs as they type (lint.js): what markdownlint can put right
// it does, away from the line being typed; the rest is listed with Go to line.
//
// Changes compares with the page as readers have it. History's "Restore this version"
// leaves an older text in sessionStorage as `restored`: the box starts from it and
// it is saved like any edit. Text that couldn't be saved is kept there too, so a
// reload doesn't lose it.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader, pageSlug, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { renderDiff } from "./diff.js";
import { goToLine, lintView, savedAt } from "./screens-shared.js";
import { fixedWords, lintLive } from "./lint.js";
import { forgetCount, rawText, titlesFrom } from "./drafts.js";
import { draftsPreview, registryBook } from "./public.js";

const IDLE_MS = 1500;
const MIN_GAP_MS = 20_000;

const store = {
  get(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* storage blocked: the text lives as long as the screen */
    }
  },
};

let leaving = null; // the open editor's beforeunload guard, while something is unsaved
const guard = (on) => {
  if (leaving) window.removeEventListener("beforeunload", leaving);
  leaving = on ? (e) => e.preventDefault() : null;
  if (leaving) window.addEventListener("beforeunload", leaving);
};
let onLeave = null; // the open editor's last save, when the author moves to another screen
window.addEventListener("hashchange", () => {
  onLeave?.();
  onLeave = null;
  guard(false);
});

export async function editScreen(slug, path, line = null) {
  const book = await bookBySlug(slug);
  const tree = await read("tree", { book: slug });
  const [file, index, reg] = await Promise.all([
    read("file", { book: slug, path, ref: tree.head }),
    path !== "index.md" && tree.files.some((f) => f.path === "index.md") ? read("file", { book: slug, path: "index.md", ref: tree.head }).catch(() => null) : null,
    registryBook(slug),
  ]);
  if (typeof file.text !== "string") throw Object.assign(new Error("not text"), { userMessage: "This page isn't text, so it can't be edited here." });
  const title = titlesFrom(index?.text).get(path, file.text);
  const known = new Set(tree.files.map((f) => f.path));
  const live = rawText(book.repo, book.live_branch, path).catch(() => undefined);

  // A textarea only knows "\n": a page written with "\r\n" goes back with it.
  const crlf = file.text.includes("\r\n");
  const original = crlf ? file.text.replace(/\r\n/g, "\n") : file.text;
  const key = `tb-edit:${slug}:${path}`;
  const kept = store.get(key);
  const restored = kept?.restored ? kept : null;
  const unsaved = !restored && kept?.base === tree.head ? kept.text : null;

  const textarea = h("textarea", { class: "editor-text", id: "editor-text", spellcheck: "true", "aria-label": `${title}, as Markdown` });
  textarea.value = restored?.text ?? unsaved ?? original;
  let base = tree.head;
  let lastSaved = original;
  let lastSaveAt = 0;
  const status = savedAt();
  status.idle("Your changes are saved to the drafts as you type.");

  // --- tabs, as editor.ts: arrow keys move between them ---
  const names = ["Edit", "Preview", "Changes"];
  const tabs = names.map((text, i) => h("button", {
    type: "button", role: "tab", id: `ed-tab-${i}`, "aria-controls": `ed-panel-${i}`,
    "aria-selected": String(i === 0), tabindex: i === 0 ? 0 : -1, text,
  }));
  const panels = [
    h("div", { role: "tabpanel", id: "ed-panel-0", "aria-labelledby": "ed-tab-0" }, textarea),
    h("div", { role: "tabpanel", id: "ed-panel-1", "aria-labelledby": "ed-tab-1", tabindex: 0, hidden: true, class: "editor-panel" }),
    h("div", { role: "tabpanel", id: "ed-panel-2", "aria-labelledby": "ed-tab-2", tabindex: 0, hidden: true, class: "editor-panel" }),
  ];
  let previewSeq = 0;
  const select = async (i) => {
    tabs.forEach((t, k) => {
      t.setAttribute("aria-selected", String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      panels[k].hidden = k !== i;
    });
    if (i === 1) {
      const seq = ++previewSeq;
      clear(panels[1], busy("Formatting the page…"));
      renderChapter(textarea.value, path, async (p) => (known.has(p) ? rawUrl(book.repo, tree.head, p) : null))
        .then((node) => seq === previewSeq && clear(panels[1], node));
    }
    if (i === 2) {
      clear(panels[2], busy("Comparing with the page readers have…"));
      const was = await live;
      if (was === undefined) return clear(panels[2], errorNote({ userMessage: "The page as readers have it couldn't be read just now." }));
      const now = textarea.value;
      clear(panels[2],
        was === null ? note([h("p", { text: "Readers don't have this page yet: all of it is new." })]) : null,
        (was ?? "").replace(/\r\n/g, "\n") === now ? h("p", { class: "muted", text: "No changes from what readers have." }) : renderDiff((was ?? "").replace(/\r\n/g, "\n"), now, title));
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = (i + d + tabs.length) % tabs.length;
      select(n);
      tabs[n].focus();
    });
  });

  // --- the live check ---
  const lintBox = h("section", { class: "lint-live", "aria-label": "Formatting", "aria-live": "polite" });
  const toLine = (n) => {
    select(0);
    goToLine(textarea, n);
  };
  const check = async () => {
    const before = textarea.value;
    let r;
    try {
      r = await lintLive(book, tree.head, path, before, textarea.selectionStart);
    } catch (err) {
      clear(lintBox, errorNote(err));
      return;
    }
    // Typed meanwhile: this answer is for older text; the next check has the new.
    if (textarea.value !== before) return;
    if (r.text !== before) {
      const focused = document.activeElement === textarea;
      const scroll = textarea.scrollTop;
      textarea.value = r.text;
      if (focused) textarea.setSelectionRange(r.caret, r.caret);
      textarea.scrollTop = scroll;
    }
    const fixed = fixedWords(r.fixed);
    clear(lintBox,
      r.problems.length
        ? [h("h2", { class: "small-heading", text: `Formatting: ${r.problems.length === 1 ? "1 thing" : `${r.problems.length} things`} to put right before you publish` }), lintView(r.problems, { go: toLine })]
        : h("p", { class: "muted small", text: "Formatting: nothing to put right." }),
      fixed ? h("p", { class: "muted small", text: fixed }) : null);
  };

  // --- saving ---
  let queue = Promise.resolve();
  let timer = null;
  const save = () => {
    queue = queue.then(async () => {
      const text = textarea.value;
      if (text === lastSaved) return;
      const wait = lastSaveAt + MIN_GAP_MS - Date.now();
      if (wait > 0) {
        clearTimeout(timer);
        timer = setTimeout(tick, wait);
        return;
      }
      status.saving();
      const body = { book: slug, base, files: [{ path, text: crlf ? text.replace(/\n/g, "\r\n") : text }], message: `Edit “${title}”` };
      try {
        let sent;
        try {
          sent = await send(body);
        } catch (err) {
          // Something else moved the drafts, not this page: the same text on the drafts as they are now.
          const c = err.status === 409 && err.body?.error === "conflict" ? err.body.conflict : null;
          if (!c?.head || (c.files ?? []).some((f) => f.path === path)) throw err;
          sent = await send({ ...body, base: c.head });
        }
        base = sent.sha;
        lastSaved = text;
        lastSaveAt = Date.now();
        forgetCount(slug);
        store.set(key, textarea.value === lastSaved ? null : { base, text: textarea.value });
        guard(textarea.value !== lastSaved);
        status.done();
      } catch (err) {
        store.set(key, { base, text });
        status.failed(err, save);
      }
    });
    return queue;
  };
  const tick = async () => {
    timer = null;
    await check();
    await save();
  };
  textarea.addEventListener("input", () => {
    guard(true);
    store.set(key, { base, text: textarea.value });
    clearTimeout(timer);
    timer = setTimeout(tick, IDLE_MS);
  });
  onLeave = () => {
    clearTimeout(timer);
    if (textarea.value !== lastSaved) {
      lastSaveAt = 0;
      save();
    }
  };

  const chapter = path.startsWith("chapters/") && /\.md$/i.test(path);
  // Links & glossary reads the drafts: what is typed goes there first.
  const tidy = chapter ? h("button", { type: "button", class: "btn", text: "Links & glossary" }) : null;
  tidy?.addEventListener("click", async () => {
    tidy.disabled = true;
    clearTimeout(timer);
    if (textarea.value !== lastSaved) {
      lastSaveAt = 0;
      await save();
      if (textarea.value !== lastSaved) return void (tidy.disabled = false); // not saved: the line says why
    }
    location.hash = `#/${slug}/tidy/${encodeURIComponent(path)}`;
  });
  const slugPath = pageSlug(path === "index.md" ? "" : path);
  const preview = draftsPreview(reg);
  const stage = [
    h("p", { class: "muted small row spaced" },
      file.last ? h("span", {}, "Last changed by ", h("strong", { text: file.last.who }), ` ${when(file.last.when)}`) : null,
      preview ? h("a", { href: `${preview}${slugPath}`, target: "_blank", rel: "noopener", text: "In the drafts preview" }) : null,
      book.domain ? h("a", { href: `https://${book.domain}/${slugPath}`, target: "_blank", rel: "noopener", text: "On the live site" }) : null),
    status.node,
    restored ? note([h("p", { text: `This is the page as it was ${when(restored.restored.when)}, from its history. It is being saved to the drafts as a new change; Changes shows what it does to the page readers have.` })]) : null,
    unsaved ? note([h("p", { text: "Your changes from before weren't saved yet. They are back in the box and are being saved now." })]) : null,
    h("div", { class: "editor" },
      h("div", { class: "editor-bar" },
        h("div", { role: "tablist", "aria-label": "Editor view" }, tabs),
        h("div", { class: "row" }, tidy, h("a", { class: "btn", href: `#/${slug}`, text: "Done" }))),
      panels),
    lintBox,
    h("p", { class: "row spaced small" },
      h("a", { href: `#/${slug}/history/${encodeURIComponent(path)}`, text: "History of this page" })),
  ];
  // The restored or unsaved text goes to the drafts straight away; the check runs either way.
  setTimeout(() => {
    tick();
    if (line) goToLine(textarea, line);
  }, 0);

  return [...bookHeader(book, "chapters", title), ...stage];
}
