// Drafts: everything that reaches readers when the author publishes, and the one
// button that does it.
//
//   Reader suggestions   proposed edits from the book's site (pull requests into
//                        drafts): Accept folds one into the drafts, Decline closes it
//                        with a note; written suggestions open on their own screen
//   What's in the drafts one line per chapter (drafts.js), with who and when, View
//                        changes and Discard (put back as readers have it, on drafts)
//   Preview              the drafts' own Pages preview
//   Before publishing    the book's formatting check (blocks, each with Fix) and its
//                        link check (doesn't); a check that couldn't run says so,
//                        with Check again, never an empty warning
//   Publish N changes    disabled only with the reason written directly above it

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { read, act, send } from "./api.js";
import { bookBySlug, bookHeader, pageSlug } from "./books.js";
import { renderDiff } from "./diff.js";
import { draftItems, discardOf, forgetCount, itemWords } from "./drafts.js";
import { lintView } from "./screens-shared.js";
import { ruleWords } from "./lint.js";
import { PREVIEW_WORDS, draftsPreview, jobs, previewState, registryBook } from "./public.js";

const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
/** A page readers open, as opposed to the book's machinery. */
const readersPage = (path) => path === "index.md" || path === "glossary.md" || path.startsWith("chapters/");

export async function draftsScreen(slug) {
  const book = await bookBySlug(slug);
  const [state, pub, changes, suggestions, reg] = await Promise.all([
    draftItems(book),
    read("publish", { book: slug }).catch((error) => ({ error })),
    read("changes", { book: slug }).catch((error) => ({ error })),
    read("suggestions", { book: slug }).catch(() => ({ suggestions: [] })),
    registryBook(slug),
  ]);
  forgetCount(slug);
  const n = state.items.length + state.more;
  const header = bookHeader(book, "drafts", "Drafts");
  header[2].querySelector('[aria-current="page"]').textContent = `Drafts (${n})`;
  return [
    ...header,
    readerSuggestions(book, changes, suggestions.suggestions ?? [], state.titles),
    h("h2", { text: n ? `What's in the drafts (${n})` : "What's in the drafts" }),
    n ? h("ul", { class: "list drafts" }, state.items.map((it) => draftLine(book, it, state)))
      : h("p", { class: "muted", text: "Nothing: readers have everything the drafts have." }),
    state.more ? h("p", { class: "muted small", text: `…and ${state.more} more.` }) : null,
    previewLine(book, reg),
    publishPart(book, state, pub, n),
    automaticJobs(reg),
  ];
}

// --- reader suggestions --------------------------------------------------------------------

function readerSuggestions(book, changes, written, titles) {
  const slug = book.slug;
  const list = changes.error ? null : changes.changes;
  if (!changes.error && !list.length && !written.length) return null;
  const row = (c) => {
    const out = h("div", { "aria-live": "polite" });
    const view = h("div", { hidden: true });
    const buttons = h("div", { class: "row" },
      h("button", { type: "button", class: "btn link", text: "View changes", onclick: async () => {
        view.hidden = !view.hidden;
        if (view.hidden || view.childElementCount) return;
        clear(view, busy("Reading the suggestion…"));
        try {
          const d = await read("change", { book: slug, number: String(c.number) });
          clear(view, d.readable
            ? d.pages.map((p) => [h("h4", { text: p.path ? titles.get(p.path) : p.page }), p.lines.map((l) => h("p", { class: `prose-change ${l.kind}` }, h("span", { class: "sr-only", text: l.kind === "before" ? "Before: " : "After: " }), l.text || " "))])
            : note([h("p", { text: d.why })]));
        } catch (err) {
          clear(view, errorNote(err));
        }
      } }),
      h("button", { type: "button", class: "btn primary", text: "Accept", onclick: (e) => answer(e.target, "change-accept", { title: c.title }) }),
      h("button", { type: "button", class: "btn", text: "Decline", onclick: (e) => answer(e.target, "change-decline") }));
    const answer = async (b, action, extra = {}) => {
      b.disabled = true;
      clear(out, busy(action === "change-accept" ? "Folding it into the drafts…" : "Declining it…"));
      try {
        await act(slug, action, { number: c.number, ...extra });
        clear(out, note([h("p", { text: action === "change-accept" ? "Accepted: it is in the drafts." : "Declined, with a note thanking them." })]));
        setTimeout(reload, 1200);
      } catch (err) {
        b.disabled = false;
        clear(out, errorNote(err));
      }
    };
    return h("li", {},
      h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", { text: c.title }), h("span", { class: "muted", text: ` — ${c.who}, ${when(c.when)}` })), buttons),
      view, out);
  };
  return [
    h("h2", { text: "Reader suggestions" }),
    changes.error ? errorNote(changes.error) : null,
    list?.length ? [h("p", { class: "muted small", text: "Edits readers proposed on the book's site. Accept puts one into the drafts; Decline closes it with a note thanking them." }), h("ul", { class: "list" }, list.map(row))] : null,
    written.length ? [
      h("h3", { text: "Written suggestions" }),
      h("ul", { class: "list" }, written.map((s) => h("li", { class: "row" },
        h("a", { class: "grow", href: `#/${slug}/suggestion/${s.number}` }, h("strong", { text: s.suggestion.length > 90 ? `${s.suggestion.slice(0, 90)}…` : s.suggestion })),
        h("span", { class: "muted small", text: `${s.who}, ${when(s.when)}` }),
        s.accepted ? h("span", { class: "badge accepted", text: "Accepted" }) : null))),
    ] : null,
  ];
}

// --- one line of the drafts ----------------------------------------------------------------

function draftLine(book, it, state) {
  const t = state.texts.get(it.path) ?? {};
  const view = h("div", { class: "draft-diff", hidden: true });
  const out = h("div", { "aria-live": "polite" });
  const undo = discardOf(it, state);
  const showChanges = () => {
    view.hidden = !view.hidden;
    if (view.hidden || view.childElementCount) return;
    if (it.kind === "order") {
      const names = (text) => (text ?? "").split(/\r?\n/).filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "")).join("\n");
      clear(view, renderDiff(names(state.liveIndex), names(state.draftsIndex), "The reading order"));
    } else if (it.kind === "pictures") {
      clear(view, h("p", { class: "muted", text: `${plural(it.files.filter((f) => f.status === "added").length, "new picture")}, ${plural(it.files.filter((f) => f.status !== "added").length, "changed or removed picture")}. Each shows in its chapter in the preview.` }));
    } else if (it.kind === "front") {
      clear(view, renderDiff(state.liveIndex ?? "", state.draftsIndex ?? "", "The front page"));
    } else clear(view, renderDiff(t.live ?? "", t.drafts ?? "", it.title));
  };
  const discard = undo ? h("button", { type: "button", class: "btn link danger", text: "Discard" }) : null;
  discard?.addEventListener("click", () => {
    const yes = h("button", { type: "button", class: "btn danger-solid", text: "Discard it" });
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      clear(out, busy("Putting it back as readers have it…"));
      try {
        await send({ book: book.slug, base: state.drafts, ...undo });
        forgetCount(book.slug);
        reload();
      } catch (err) {
        const moved = err.status === 409 && err.body?.error === "conflict";
        clear(out, errorNote(moved ? { userMessage: "Nothing was discarded: the drafts changed meanwhile. Look again." } : err), moved ? h("button", { type: "button", class: "btn", text: "Look again", onclick: reload }) : null);
      }
    });
    clear(out, h("div", { class: "note warn", role: "alertdialog", "aria-label": "Discard?" },
      h("p", { text: `${itemWords(it)}: put it back as readers have it? This takes it out of the drafts; History keeps it.` }),
      h("div", { class: "row" }, yes, h("button", { type: "button", class: "btn", text: "Keep it", onclick: () => clear(out) }))));
    yes.focus();
  });
  return h("li", {},
    h("div", { class: "row" },
      h("div", { class: "grow" },
        it.path && readersPage(it.path) && it.kind !== "removed" && it.kind !== "order" ? h("a", { href: `#/${book.slug}/edit/${encodeURIComponent(it.path)}`, text: itemWords(it) }) : h("span", { text: itemWords(it) }),
        h("div", { class: "muted small", text: [it.who, it.when ? when(it.when) : null].filter(Boolean).join(", ") })),
      h("button", { type: "button", class: "btn link", text: "View changes", onclick: showChanges }),
      discard),
    view, out);
}

// --- preview -------------------------------------------------------------------------------

function previewLine(book, reg) {
  const url = draftsPreview(reg);
  if (!url) return null;
  const words = h("p", { class: "muted small" });
  fetch(`https://api.github.com/repos/${book.repo}/commits/${encodeURIComponent(book.drafts_branch)}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((c) => previewState(reg, c?.sha, c?.commit?.committer?.date))
    .then((p) => p && words.replaceChildren(PREVIEW_WORDS[p.state === "stale" && !p.hasBuild ? "stale_none" : p.state]));
  return [
    h("div", { class: "actions" }, h("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: "Preview the book with drafts" })),
    words,
  ];
}

// --- the checklist and the button ------------------------------------------------------------

function publishPart(book, state, pub, n) {
  const slug = book.slug;
  const titles = state.titles;
  const p = pub.error ? null : pub.publish;
  const checks = [];
  let reason = null;
  const again = () => h("button", { type: "button", class: "btn", text: "Check again", onclick: reload });

  if (pub.error) {
    checks.push(note([h("p", { text: "The checks couldn't be fetched just now, so publishing waits for them." }), h("div", { class: "actions" }, again())], "warn"));
    reason = "The checks couldn't be fetched just now.";
  } else if (p && !Array.isArray(p.lint)) {
    checks.push(note([h("p", { text: "The formatting check couldn't be run just now, so publishing waits for it." }), h("div", { class: "actions" }, again())], "warn"));
    reason = "The formatting check couldn't be run just now.";
  } else if (p) {
    const mine = p.lint.filter((x) => readersPage(x.path));
    const behind = p.lint.length - mine.length;
    const more = (p.lint_count ?? p.lint.length) - p.lint.length;
    if (p.lint.length) {
      checks.push(h("section", { class: "check bad", "aria-label": "Formatting" },
        h("h3", { text: `Formatting: ${plural(p.lint_count ?? p.lint.length, "problem")} to fix` }),
        mine.length ? lintView(mine.map((x) => ({ ...x, words: ruleWords(x.rule, x.description) })), {
          href: (path, line) => `#/${slug}/edit/${encodeURIComponent(path)}/line/${line}`,
          title: (path) => titles.get(path),
        }) : null,
        behind ? h("p", { class: "muted small", text: `${plural(behind, "problem")} in the book's behind-the-scenes files, which the author site doesn't edit: tell the technical contact.` }) : null,
        more > 0 ? h("p", { class: "muted small", text: `…and ${more} more after these.` }) : null));
      reason = `Fix the ${plural(p.lint_count ?? p.lint.length, "formatting problem")} above first.`;
    } else {
      checks.push(h("p", { class: "check ok", text: "✓ Formatting: nothing to fix." }));
    }
    const dead = p.links?.dead ?? [];
    if (dead.length) {
      checks.push(h("section", { class: "check info", "aria-label": "Links" },
        h("h3", { text: `${plural(dead.length, "link")} to other websites ${dead.length === 1 ? "doesn't" : "don't"} work` }),
        h("p", { class: "muted small", text: `This doesn't stop publishing: other sites move things. Fix or remove ${dead.length === 1 ? "it" : "them"} when you can.${p.links.checked ? "" : " (From the last check; the newest changes are still being checked.)"}` }),
        h("ul", {}, dead.map((d) => h("li", {}, h("strong", { text: titles.get(d.file) }), ": ", h("a", { href: d.url, target: "_blank", rel: "noopener noreferrer", text: d.url }))))));
    }
    if (!reason && p.open && p.state === "conflict") reason = p.state_words;
    if (!reason && p.open && ["blocked", "unknown"].includes(p.state)) {
      reason = p.state_words;
      checks.push(h("div", { class: "actions" }, again()));
    }
  }
  if (!n) reason = "Nothing to publish: readers have everything the drafts have.";

  const outcome = h("div", { "aria-live": "polite" });
  const why = h("p", { class: "publish-reason", id: "publish-reason", text: reason ?? "" });
  why.hidden = !reason;
  const go = h("button", { type: "button", class: "btn primary big", text: `Publish ${plural(n, "change")}`, disabled: Boolean(reason), "aria-describedby": reason ? "publish-reason" : null });
  const publish = async () => {
    go.disabled = true;
    clear(outcome, busy("Publishing… readers will see it in about 3 minutes."));
    try {
      let number = p?.open ? p.number : null;
      if (!number) {
        const prep = await act(slug, "publish-prepare");
        number = prep.publish?.number;
        if (!number || !prep.publish.can_publish) throw { userMessage: prep.publish?.state_words ?? "There turned out to be nothing to publish." };
      }
      await act(slug, "publish", { number, confirm: true });
      forgetCount(slug);
      const pages = state.items.filter((i) => ["new", "edited"].includes(i.kind) && readersPage(i.path));
      clear(outcome, h("div", { class: "published" },
        h("h3", { text: "Published" }),
        h("p", { text: "The book is rebuilding: readers see the changes in about 3 minutes." }),
        pages.length && book.domain ? h("ul", {}, pages.map((i) => h("li", {}, h("a", { href: `https://${book.domain}/${pageSlug(i.path === "index.md" ? "" : i.path)}`, target: "_blank", rel: "noopener", text: i.title })))) : null,
        h("div", { class: "actions" }, h("a", { class: "btn", href: `#/${slug}`, text: "Back to the chapters" }))));
      go.remove();
      why.remove();
    } catch (err) {
      go.disabled = false;
      clear(outcome, errorNote(err), h("div", { class: "actions" }, h("button", { type: "button", class: "btn", text: "Try again", onclick: publish })));
    }
  };
  go.addEventListener("click", publish);
  return [
    h("h2", { text: "Before publishing" }),
    checks.length ? checks : h("p", { class: "muted", text: "Nothing to check." }),
    h("div", { class: "publish" }, why, go),
    outcome,
  ];
}

// --- the automatic jobs (nothing to do, unless one fails) --------------------------------------

function automaticJobs(reg) {
  if (!reg) return null;
  const box = h("div", {}, busy("Asking GitHub…"));
  jobs(reg).then((list) => {
    if (!list) return clear(box, h("p", { class: "muted", text: "GitHub couldn't be asked about them just now." }));
    if (!list.length) return clear(box, h("p", { class: "muted", text: "This book has none." }));
    clear(box, h("ul", { class: "list" }, list.map((j) => h("li", { class: "row" },
      h("span", { class: "grow", text: j.name }),
      j.state === "ok" ? h("span", { class: "muted", text: `Finished properly ${when(j.when)}` })
        : j.state === "failed" ? h("span", { class: "error" }, "Did not finish ", when(j.when), " · ", h("a", { href: j.url, target: "_blank", rel: "noopener", text: "details" }))
          : h("span", { class: "muted", text: "Hasn't run yet" })))),
    h("p", { class: "muted small", text: "Nothing to do here. If one says it did not finish, tell the technical contact." }));
  });
  return h("details", { class: "jobs" }, h("summary", { text: "The book's automatic jobs" }), box);
}
