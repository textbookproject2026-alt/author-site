// A reader's written suggestion or note (an issue from the book's site): what they wrote,
// and Review it, which opens its page's review at it: suggestions are accepted or declined
// there (an exact replacement is made there too). One accepted the old way, "I'll make the
// change" (taken on by hand), is closed here once the change is made: I've made the change.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, act } from "./api.js";
import { bookBySlug, bookHeader, pageSlug } from "./books.js";
import { suggested, reviewHref, ACCEPT_WORDS, DECLINE_WORDS } from "./suggestions.js";
import { reviewBackLink } from "./screens-review.js";

/** A button that runs `fn`, showing progress and then what happened in `out`. */
function doButton(text, cls, out, fn) {
  const b = h("button", { type: "button", class: `btn ${cls}`.trim(), text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    clear(out, busy("Working…"));
    try {
      await fn(b);
    } catch (err) {
      clear(out, errorNote(err));
      b.disabled = false;
    }
  });
  return b;
}

const done = (res, back) => [
  h("ul", { class: "steps" }, (res.steps ?? []).map((s) => h("li", { text: s }))),
  res.warning ? note([h("p", { text: res.warning })], "warn") : null,
  back ? h("p", {}, h("a", { href: back, text: "Back to Drafts" })) : null,
];

export async function suggestionScreen(slug, number) {
  const book = await bookBySlug(slug);
  const { suggestions } = await read("suggestions", { book: slug });
  const s = suggestions.find((x) => x.number === number);
  const back = `#/${slug}/drafts`;
  if (!s) return [...bookHeader(book, "drafts", "A suggestion from a reader"), reviewBackLink(slug), note([h("p", { text: "This suggestion has already been dealt with." })]), h("p", {}, h("a", { href: back, text: "Back to Drafts" }))];
  const out = h("div", { "aria-live": "polite" });
  const onSite = book.domain && s.path ? `https://${book.domain}/${pageSlug(s.path)}` : null;

  let actions;
  if (!s.accepted) {
    actions = h("div", { class: "actions" },
      s.path ? h("a", { class: "btn primary", href: reviewHref(slug, s.path, number), text: "Review it in the page" }) : null,
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  } else {
    actions = h("div", { class: "actions" },
      doButton("I've made the change", "primary", out, async () => {
        const { changes } = await read("suggestion-changes", { book: slug, number: String(number) });
        const newest = changes[0];
        if (!newest) {
          clear(out, note([h("p", { text: `Nothing has changed the page in the drafts since you accepted this, so there is no change to show the reader yet. Make the change, then press this again.` })], "warn"));
          return;
        }
        const confirm = doButton("Yes: thank the reader with a link to it", "primary", out, async () => {
          clear(out, ...done(await act(slug, "suggestion-made", { number, sha: newest.sha }), back));
          actions.remove();
        });
        clear(out, h("div", { class: "card" },
          h("p", {}, "The latest change to the page in the drafts: ",
            h("a", { href: newest.url, target: "_blank", rel: "noopener", text: newest.message || "a change" }), ` — ${newest.who}, ${when(newest.when)}.`),
          h("p", { text: "Is that the change the reader asked for? The reader is sent a link to it, and the suggestion is closed." }),
          h("div", { class: "actions" }, confirm)));
      }),
      s.path ? h("a", { class: "btn", href: `#/${slug}/edit/${encodeURIComponent(s.path)}`, text: "Edit the page" }) : null,
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  }

  return [
    ...bookHeader(book, "drafts", "A suggestion from a reader"),
    reviewBackLink(slug),
    h("p", { class: "muted" }, "From ", h("strong", { text: s.who }), `, ${when(s.when)}, about `,
      onSite ? h("a", { href: onSite, target: "_blank", rel: "noopener", text: "this page" }) : "a page", ".",
      s.accepted ? [" ", h("span", { class: "badge accepted", text: "Accepted" })] : null),
    h("h2", { text: "What they suggest" }),
    suggested(s),
    s.reasoning ? [h("h3", { text: "Why" }), h("blockquote", { class: "said", text: s.reasoning })] : null,
    s.accepted
      ? note([h("p", { text: "You've taken this on, and the reader has been thanked. Once the change is in the drafts area (made with Edit on the page, say), press “I've made the change”." })])
      : note([h("p", { text: `Accept or decline it in the page's review, where it shows in place. ${ACCEPT_WORDS}` }), h("p", { text: DECLINE_WORDS })]),
    actions,
    out,
  ];
}
