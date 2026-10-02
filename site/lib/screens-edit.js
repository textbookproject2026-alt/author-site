// Editing a whole page of the book: the books' in-site editor (quartz-edition-extras
// edit-on-github editor.ts) laid out as a screen of this site: Edit | Preview |
// Changes, with Cancel and Send beside the tabs. The Preview is the chapter view's
// (preview.js) and Changes is the editor's word-level diff (diff.js), both copied
// from it already.
//
// Sending is one commit on the drafts area through author-send, made by the signed-in
// author, on the drafts commit the page was read at. If the drafts moved meanwhile,
// nothing is written (409): when this page wasn't among what moved, the edit is
// offered again on the drafts as they are now; when it was, the author's text is
// kept for them to copy and the page has to be opened again.
//
// The unsent text is kept in sessionStorage (this tab only) under the page and the
// blob it was edited from, so moving to another screen and back doesn't lose it.

import { h, clear, busy, note, errorNote } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { renderDiff } from "./diff.js";
import { conflictView, sentView } from "./screens-shared.js";

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

let leaving = null; // the open editor's beforeunload guard
const guard = (on) => {
  if (leaving) window.removeEventListener("beforeunload", leaving);
  leaving = on ? (e) => e.preventDefault() : null;
  if (leaving) window.addEventListener("beforeunload", leaving);
};
window.addEventListener("hashchange", () => guard(false));

export async function editScreen(slug, path) {
  const book = await bookBySlug(slug);
  const tree = await read("tree", { book: slug });
  const file = await read("file", { book: slug, path, ref: tree.head });
  const name = path.split("/").pop();
  if (typeof file.text !== "string") throw Object.assign(new Error("not text"), { userMessage: "This file isn't text, so it can't be edited here." });

  // A textarea only knows "\n": a page written with "\r\n" goes back with it.
  const crlf = file.text.includes("\r\n");
  const original = crlf ? file.text.replace(/\r\n/g, "\n") : file.text;
  const key = `tb-edit:${slug}:${path}`;
  const kept = store.get(key);
  const known = new Set(tree.files.map((f) => f.path));
  const back = `#/${slug}/chapter/${encodeURIComponent(path)}`;
  let base = tree.head;

  const textarea = h("textarea", { class: "editor-text", id: "editor-text", spellcheck: "true", "aria-label": `${name}, as Markdown` });
  textarea.value = kept?.sha === file.sha ? kept.text : original;
  const current = () => textarea.value;
  const dirty = () => current() !== original;

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
  const select = (i) => {
    tabs.forEach((t, k) => {
      t.setAttribute("aria-selected", String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      panels[k].hidden = k !== i;
    });
    if (i === 1) {
      const seq = ++previewSeq;
      clear(panels[1], busy("Formatting the page…"));
      renderChapter(current(), path, async (p) => (known.has(p) ? rawUrl(book.repo, tree.head, p) : null))
        .then((node) => seq === previewSeq && clear(panels[1], node));
    }
    if (i === 2) clear(panels[2], dirty() ? renderDiff(original, current(), path) : h("p", { class: "muted", text: "No changes yet." }));
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

  // --- Cancel, Send ---
  const sendBtn = h("button", { type: "button", class: "btn primary", text: "Send to drafts" });
  const cancel = h("button", { type: "button", class: "btn", text: "Cancel" });
  const discard = h("div", { class: "note warn", role: "alert", hidden: true },
    h("p", { text: "Discard your changes to this page?" }),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn", text: "Discard", onclick: () => {
        store.set(key, null);
        guard(false);
        location.hash = back;
      } }),
      h("button", { type: "button", class: "btn primary", text: "Keep editing", onclick: () => {
        discard.hidden = true;
        textarea.focus();
      } })));
  cancel.addEventListener("click", () => {
    if (!dirty()) return void (location.hash = back);
    discard.hidden = false;
    discard.querySelector(".btn.primary").focus();
  });
  const message = h("input", { type: "text", id: "edit-message", maxlength: 150, autocomplete: "off", placeholder: `Edit ${name}` });
  const outcome = h("div", { class: "outcome", "aria-live": "polite" });
  const sync = () => {
    sendBtn.disabled = !dirty();
    guard(dirty());
    store.set(key, dirty() ? { sha: file.sha, text: current() } : null);
  };
  textarea.addEventListener("input", sync);

  const stage = h("div");
  const go = async () => {
    sendBtn.disabled = true;
    clear(outcome, busy("Sending it to the drafts area…"));
    const text = crlf ? current().replace(/\n/g, "\r\n") : current();
    try {
      const sent = await send({ book: slug, base, files: [{ path, text }], message: message.value.trim() || `Edit ${name}` });
      store.set(key, null);
      guard(false);
      clear(stage, ...sentView(book, sent, "Sent to the drafts area", [],
        h("a", { class: "btn primary", href: back, text: "Back to the page" })));
    } catch (err) {
      sendBtn.disabled = false;
      if (err.status !== 409 || err.body?.error !== "conflict") return clear(outcome, errorNote(err));
      const conflict = err.body.conflict ?? {};
      const moved = (conflict.files ?? []).some((f) => f.path === path);
      if (!moved && conflict.head) {
        // Nobody else touched this page: the edit is the same on the drafts as they are now.
        const again = h("button", { type: "button", class: "btn primary", text: "Send it on the drafts as they are now" });
        again.addEventListener("click", () => {
          base = conflict.head;
          go();
        });
        clear(outcome, conflictView(conflict),
          note([h("p", { text: `${name} isn't among the changes, so your edit applies to the drafts as they are now exactly as it is.` })]),
          h("div", { class: "actions" }, again));
      } else {
        sendBtn.disabled = true;
        clear(outcome, conflictView(conflict),
          note([h("p", { text: `${name} itself was changed meanwhile, shown above. Your text is still in the box: copy what you need, then open the page again to start from it as it is now, and put your changes back in.` })], "warn"),
          h("div", { class: "actions" }, h("button", { type: "button", class: "btn", text: "Open the page again", onclick: () => {
            guard(false);
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          } })));
      }
      outcome.scrollIntoView({ block: "start" });
    }
  };
  sendBtn.addEventListener("click", go);

  const older = kept && kept.sha !== file.sha ? kept.text : null;
  clear(stage,
    kept?.sha === file.sha && dirty() ? note([h("p", { text: "Your unsent changes from earlier are back. Send them, or Cancel to discard them." })]) : null,
    older ? note([
      h("p", { text: "You had unsent changes to an earlier version of this page, which has changed since. They are below to copy from; the box starts from the page as it is now." }),
      h("details", {}, h("summary", { text: "Your earlier text" }), h("textarea", { class: "editor-text short", readonly: true, "aria-label": "Your earlier text" }, older)),
      h("button", { type: "button", class: "btn link", text: "Forget the earlier text", onclick: (e) => {
        store.set(key, null);
        e.target.closest(".note").remove();
      } }),
    ], "warn") : null,
    discard,
    h("div", { class: "editor" },
      h("div", { class: "editor-bar" },
        h("div", { role: "tablist", "aria-label": "Editor view" }, tabs),
        h("div", { class: "row" }, cancel, sendBtn)),
      panels),
    h("label", { class: "field" }, "What did you change? ", h("span", { class: "muted", text: "(optional, one line)" }), message),
    h("p", { class: "muted small", text: "Send makes one change of its own on the drafts area, made by you. Readers see it once the drafts are published, under Waiting for you. If anything else changed the drafts area since you opened this page, nothing is sent and you are shown it." }),
    outcome);
  sync();

  return [
    ...bookHeader(book, "chapters", `Edit ${name.replace(/\.md$/i, "")}`),
    h("p", { class: "muted small" }, h("code", { text: path }), " · the drafts area, as it was when you opened it"),
    stage,
  ];
}
