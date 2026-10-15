// Drafts: by chapter, the unit for both review and publish (drafts.js rowsOf).
//
//   top        one summary line ("2 chapters to review, 3 ready to publish"), Publish all (N)
//              and Preview the book with drafts
//   rows       one per chapter needing anything, in Contents order, then "Rest of the book"
//              (pages other than chapters, the front page, settings, notes on no chapter):
//              title, one status line, one primary button for the next step: Review when
//              readers have something waiting, else Publish, or the formatting problems to
//              fix in its place. View changes and Discard in its ⋯ menu.
//   then       "N chapters up to date" for the rest of the Contents
//   Publish all   asks first, with the checks on what goes live (formatting, links)
//
// Nothing accepted, declined or done is here: History has it. People are named, never an
// account or a bot; file names never.

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { read, act, send } from "./api.js";
import { own } from "./auth.js";
import { bookBySlug, bookHeader, pageSlug } from "./books.js";
import { renderDiff } from "./diff.js";
import { REST, draftItems, discardOf, forgetCount, itemWords, readerItems, rowsOf } from "./drafts.js";
import { lintView } from "./screens-shared.js";
import { ruleWords } from "./lint.js";
import { PREVIEW_WORDS, draftsPreview, jobs, previewState, registryBook } from "./public.js";
import { publishChapterButton } from "./publish-chapter.js";

const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
/** A page readers open, as opposed to the book's machinery. */
const readersPage = (path) => path === "index.md" || path === "glossary.md" || path.startsWith("chapters/");

/** GitHub login (lower-cased) -> the name the book knows them by, from the author site's members. */
async function namesOf(slug) {
  const p = await own(`/api/members?book=${encodeURIComponent(slug)}`).catch(() => null);
  return new Map((p?.members ?? []).filter((m) => m.github && m.name && m.name.toLowerCase() !== m.github.toLowerCase()).map((m) => [m.github.toLowerCase(), m.name]));
}
/** Who changed it: a person's name, never an account or a bot. */
const personOf = (it, names) => it.who ?? (it.login && names.get(it.login.toLowerCase())) ?? "a book author";

/** "2 chapters and the rest of the book" */
const rowsWords = (rows) => {
  const ch = rows.filter((r) => r.key !== REST).length;
  const rest = rows.some((r) => r.key === REST);
  return [ch ? plural(ch, "chapter") : null, rest ? "the rest of the book" : null].filter(Boolean).join(" and ");
};

export async function draftsScreen(slug) {
  const book = await bookBySlug(slug);
  const [state, pub, readers, reg, names] = await Promise.all([
    draftItems(book),
    read("publish", { book: slug }).catch((error) => ({ error })),
    // Never an empty list for a read that failed: that hid real suggestions (13 Oct).
    readerItems(slug).catch((error) => ({ error })),
    registryBook(slug),
    namesOf(slug),
  ]);
  forgetCount(slug);
  const p = pub.error ? null : pub.publish;
  const { rows, upToDate } = rowsOf(state, readers.changes ?? [], readers.written ?? [], Array.isArray(p?.lint) ? p.lint : null);
  const header = bookHeader(book, "drafts", "Drafts");
  header[2].querySelector('[aria-current="page"]').textContent = `Drafts (${rows.length})`;
  const toReview = rows.filter((r) => r.next === "review");
  const toPublish = rows.filter((r) => r.next === "publish");
  const toFix = rows.filter((r) => r.next === "fix");
  const summary = rows.length
    ? [toReview.length ? `${rowsWords(toReview)} to review` : null, toPublish.length ? `${rowsWords(toPublish)} ready to publish` : null,
      toFix.length ? `${rowsWords(toFix)} with problems to fix` : null].filter(Boolean).join(", ")
    : "Nothing waiting: readers have everything the drafts have, and nothing from readers is waiting.";
  const going = rows.filter((r) => r.drafts.length || r.pictures?.length).length;
  const all = publishAll(book, state, pub, going);
  return [
    ...header,
    h("p", { class: "drafts-summary", text: summary }),
    h("div", { class: "drafts-top" }, all.button, previewLink(book, reg)),
    all.panel,
    readers.error ? couldntLoad() : null,
    rows.length ? h("ul", { class: "drafts-rows" }, rows.map((r) => rowLine(book, r, state, names))) : null,
    upToDate ? h("p", { class: "muted drafts-uptodate", text: `${plural(upToDate, "chapter")} up to date` }) : null,
    automaticJobs(reg),
  ];
}

/** In place of a list that couldn't be had: say so, with Try again. */
const couldntLoad = () =>
  note([h("p", { text: "What readers sent couldn't be loaded just now, so some of it may be missing here." }), h("button", { type: "button", class: "secondary", text: "Try again", onclick: reload })], "warn");

// --- one row -------------------------------------------------------------------------------

function rowLine(book, r, state, names) {
  const slug = book.slug;
  const out = h("div", { class: "row-out", "aria-live": "polite" });
  const view = h("div", { class: "draft-diff", hidden: true });
  let primary;
  if (r.next === "review") {
    primary = h("a", { class: "btn primary", href: r.key === REST ? `#/${slug}/review-rest` : `#/${slug}/review/${encodeURIComponent(r.path)}`, text: "Review" });
  } else if (r.next === "fix") {
    const first = r.lint[0];
    primary = h("a", { class: "btn primary", href: `#/${slug}/edit/${encodeURIComponent(first.path)}/line/${first.line}`, text: `${plural(r.lint.length, "problem")} to fix` });
  } else {
    const b = publishChapterButton(book, r.key === REST ? null : r.path, r.title, { label: "Publish", primary: true, wrap: false });
    primary = b.button;
    out.append(b.out);
  }
  // ⋯: View changes and Discard, when the drafts hold something here.
  const menu = r.drafts.length ? moreMenu([
    ["View changes", () => {
      view.hidden = !view.hidden;
      if (!view.hidden && !view.childElementCount) clear(view, r.drafts.map((it) => changeView(book, it, state, names, r.key === REST)));
    }],
    // One change: Discard here. The Rest of the book's several: each in View changes, with its own.
    r.drafts.length === 1 && discardOf(r.drafts[0], state) ? ["Discard", () => askDiscard(book, r.drafts[0], state, out)] : null,
  ]) : null;
  return h("li", { class: "drafts-row", "data-row": r.key },
    h("div", { class: "drafts-row-main" },
      h("div", { class: "drafts-row-text" },
        h("strong", { class: "drafts-row-title", text: r.title }),
        h("p", { class: "muted drafts-row-status", text: r.status })),
      h("div", { class: "drafts-row-go" }, primary),
      menu),
    out, view);
}

/** The ⋯ menu: a native disclosure; each entry closes it. */
function moreMenu(entries) {
  const box = h("details", { class: "more-menu" },
    h("summary", { "aria-label": "More", title: "More", text: "⋯" }),
    h("div", { class: "more-menu-list", role: "menu" }, entries.filter(Boolean).map(([text, fn]) => h("button", { type: "button", role: "menuitem", class: "btn link", text, onclick: () => {
      box.open = false;
      fn();
    } }))));
  return box;
}

/** One thing the drafts hold, against the live book: what, who and when, and the difference. */
function changeView(book, it, state, names, discardHere) {
  const t = state.texts.get(it.path) ?? {};
  const out = h("div", { "aria-live": "polite" });
  let diff;
  if (it.kind === "order") {
    const titles = (text) => (text ?? "").split(/\r?\n/).filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "")).join("\n");
    diff = renderDiff(titles(state.liveIndex), titles(state.draftsIndex), "The reading order");
  } else if (it.kind === "pictures") {
    diff = h("p", { class: "muted", text: `${plural(it.files.filter((f) => f.status === "added").length, "new picture")}, ${plural(it.files.filter((f) => f.status !== "added").length, "changed or removed picture")}. Each shows in its page in the preview.` });
  } else if (it.kind === "front" || it.kind === "type") {
    diff = renderDiff(state.liveIndex ?? "", state.draftsIndex ?? "", it.kind === "type" ? "Settings" : "The front page");
  } else diff = renderDiff(t.live ?? "", t.drafts ?? "", it.title);
  const undo = discardHere && discardOf(it, state);
  return h("section", { class: "draft-change", "aria-label": itemWords(it) },
    h("div", { class: "row" },
      h("div", { class: "grow" },
        h("strong", { text: itemWords(it) }),
        h("p", { class: "muted small", text: [`Changed by ${personOf(it, names)}`, it.when ? when(it.when) : null].filter(Boolean).join(", ") })),
      undo ? h("button", { type: "button", class: "btn link danger", text: "Discard", onclick: () => askDiscard(book, it, state, out) }) : null),
    diff, out);
}

/** Discard asks first: put it back as readers have it, on the drafts. */
function askDiscard(book, it, state, out) {
  const undo = discardOf(it, state);
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
}

// --- preview -------------------------------------------------------------------------------

function previewLink(book, reg) {
  const url = draftsPreview(reg);
  if (!url) return null;
  const words = h("span", { class: "muted small drafts-preview-state" });
  fetch(`https://api.github.com/repos/${book.repo}/commits/${encodeURIComponent(book.drafts_branch)}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((c) => previewState(reg, c?.sha, c?.commit?.committer?.date))
    .then((p) => p && words.replaceChildren(PREVIEW_WORDS[p.state === "stale" && !p.hasBuild ? "stale_none" : p.state]));
  return h("span", { class: "drafts-preview" }, h("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: "Preview the book with drafts" }), words);
}

// --- Publish all: asks first, with the checks ---------------------------------------------------

function publishAll(book, state, pub, n) {
  const slug = book.slug;
  const titles = state.titles;
  const p = pub.error ? null : pub.publish;
  const button = h("button", { type: "button", class: "btn", text: `Publish all (${n})`, disabled: !n, "aria-expanded": "false" });
  const panel = h("section", { class: "publish-all", "aria-label": "Publish all", hidden: true });
  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && !panel.childElementCount) draw();
  });
  const again = () => h("button", { type: "button", class: "btn", text: "Check again", onclick: reload });

  function draw() {
    const checks = [];
    let reason = null;
    if (pub.error) {
      checks.push(note([h("p", { text: "The checks couldn't be fetched just now, so publishing waits for them." }), h("div", { class: "actions" }, again())], "warn"));
      reason = "The checks couldn't be fetched just now.";
    } else if (p && !Array.isArray(p.lint) && p.lint_job?.sha) {
      checks.push(lintChecking(slug, p.lint_job.sha, again));
      reason = "The formatting is being checked.";
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
        reason = `Fix the ${plural(p.lint_count ?? p.lint.length, "formatting problem")} first.`;
      } else checks.push(h("p", { class: "check ok", text: "✓ Formatting: nothing to fix." }));
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
    const go = h("button", { type: "button", class: "btn primary", text: `Publish all ${n}`, disabled: Boolean(reason), "aria-describedby": reason ? "publish-reason" : null });
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
    clear(panel,
      h("h2", { class: "small-heading", text: `Publish all: ${n === 1 ? "this goes" : `these ${n} go`} to readers` }),
      checks.length ? checks : null,
      h("div", { class: "publish" }, why, h("div", { class: "row" }, go, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      } }))),
      outcome);
  }
  return { button, panel };
}

/**
 * The book's lint runs as a job off the function (book-requests' author-lint, about a
 * minute). While it runs this says so, with the time so far, and asks whether it has
 * answered: after 2 s, then every 4 s, for 3 minutes at most, and never once the screen
 * is gone. When it has, the screen is drawn again with the answer.
 */
const LINT_DEADLINE_MS = 3 * 60 * 1000;
function lintChecking(slug, sha, again) {
  const started = Date.now();
  const time = h("span", { class: "muted small", text: "" });
  const box = note([h("p", {}, "Checking the formatting of what would go live. This takes about a minute. ", time)]);
  box.setAttribute("aria-live", "polite");
  box.setAttribute("aria-busy", "true");
  const ask = async () => {
    if (!box.isConnected) return;
    const waited = Date.now() - started;
    if (waited > LINT_DEADLINE_MS) {
      box.setAttribute("aria-busy", "false");
      clear(box, h("p", { text: "The formatting check is taking longer than it should. Press Check again in a moment." }), h("div", { class: "actions" }, again()));
      return;
    }
    time.textContent = `(${Math.round(waited / 1000)} s so far)`;
    const answer = await read("lint", { book: slug, sha }).catch(() => null);
    if (!box.isConnected) return;
    if (answer?.lint?.state && answer.lint.state !== "checking") reload();
    else setTimeout(ask, 4000);
  };
  setTimeout(ask, 2000);
  return box;
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
