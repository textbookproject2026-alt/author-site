// The author site: everything an author does after their book is set up, in the
// browser. Plain ES modules, no framework and no build step: a handful of screens,
// each drawn from what the author endpoints say, with every change made through them.
//
// Routes (the hash, so a static host serves one page):
//   #/                          your books
//   #/<book>                    Chapters: the reading order, each chapter's status
//   #/<book>/edit/<path>[/line/<n>]  the editor (at line n); saves to the drafts as you type
//   #/<book>/import             bring in a document
//   #/<book>/new/<chapter|concept>  a new chapter or concept page, written here
//   #/<book>/drafts             Drafts: reader suggestions, what's changed, Publish
//   #/<book>/suggestion/<n>     one written reader suggestion
//   #/<book>/tidy/<path>        Links & glossary: a chapter's citations, concept links, glossary, AI formatting
//   #/<book>/tidy-all/<glossary|concepts>[/<n>]  the same, book-wide, chapter by chapter
//   #/<book>/people             who can work on it; invite, remove; what changed
//   #/link/<token>              a sign-in link from an email
//   #/invite/<token>            an invitation: confirm your name, then you're in
//   #/claim/<token>             confirm the email address you'll sign in with
//   #/<book>/history[/<path>]   the drafts' history, of the book or one page
//   #/<book>/credits[/<path>]   the book's (or a chapter's) authors and editors
//   #/<book>/revision/<sha>[/<path>]  one change; one page at it, Restore, Bring it back
//   #/settings                  the author's own DeepSeek key, in this browser
// Older links (#/<book>/waiting, /publish, /change/<n>, /chapter/<path>) still land.

import { h, clear, busy, errorNote } from "./lib/dom.js";
import { acceptInvitation, consumeLink, githubSigninOn, identity, invitation, loadMe, onChange, own, requestLink, signInWithGitHub, signOut } from "./lib/auth.js";
import { booksScreen, chaptersScreen, chapterScreen } from "./lib/screens-books.js";
import { importScreen } from "./lib/screens-import.js";
import { tidyScreen, tidyAllScreen } from "./lib/screens-tidy.js";
import { editScreen } from "./lib/screens-edit.js";
import { settingsScreen } from "./lib/screens-settings.js";
import { peopleScreen } from "./lib/screens-people.js";
import { historyScreen, revisionScreen } from "./lib/screens-history.js";
import { creditsScreen } from "./lib/screens-credits.js";
import { suggestionScreen } from "./lib/screens-suggestion.js";
import { privacyNote } from "./lib/privacy.js";
import { newChapterScreen, newConceptScreen } from "./lib/screens-new.js";
import { draftsScreen } from "./lib/screens-drafts.js";

const main = document.getElementById("main");

// --- theme ------------------------------------------------------------------------------

const toggle = document.getElementById("theme-toggle");
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.getAttribute("data-theme") ?? (systemDark.matches ? "dark" : "light")) === "dark";
const showTheme = () => {
  toggle.setAttribute("aria-pressed", String(isDark()));
  toggle.setAttribute("aria-label", isDark() ? "Dark mode is on. Switch to light" : "Light mode is on. Switch to dark");
};
toggle.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* storage blocked: this visit only */
  }
  showTheme();
});
systemDark.addEventListener("change", showTheme);
showTheme();

// --- who is signed in -------------------------------------------------------------------

// An account button (the avatar, and the login where there's room) opens a menu with
// the full name, the guide, Settings and Sign out (batch 2b: on a phone the six
// controls didn't fit one row and broke inside their words).
const who = document.getElementById("who");
let closeMenu = () => {};
function showWho(id) {
  closeMenu();
  document.body.classList.toggle("signed-in", Boolean(id));
  if (!id) {
    who.hidden = true;
    clear(who);
    return;
  }
  const label = id.name;
  const button = h("button", { type: "button", class: "account-btn", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "account-menu", "aria-label": `Account: ${label}` },
    h("span", { class: "initial", "aria-hidden": "true", text: (id.name || "?").slice(0, 1).toUpperCase() }),
    h("span", { class: "login", "aria-hidden": "true", text: label }));
  const menu = h("div", { class: "account-menu", id: "account-menu", role: "menu", hidden: true },
    h("p", { class: "account-name" }, h("strong", { text: id.name }), id.email ?? "No email address yet"),
    h("hr", {}),
    h("a", { role: "menuitem", href: "https://guide.confused4now.org", target: "_blank", rel: "noopener", text: "Guide for authors" }),
    h("a", { role: "menuitem", href: "#/settings", text: "Settings" }),
    h("button", { type: "button", role: "menuitem", text: "Sign out", onclick: () => signOut() }),
    h("button", { type: "button", role: "menuitem", text: "Sign out everywhere", onclick: () => signOut(true) }));
  const onDoc = (e) => {
    if (!who.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      closeMenu();
      button.focus();
    }
  };
  closeMenu = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    document.removeEventListener("keydown", onKey);
  };
  button.addEventListener("click", () => {
    if (!menu.hidden) return closeMenu();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDoc, true);
    document.addEventListener("keydown", onKey);
    menu.querySelector("a, button")?.focus();
  });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeMenu();
  });
  clear(who, button, menu);
  who.hidden = false;
}
window.addEventListener("hashchange", () => closeMenu());
onChange((id) => {
  showWho(id);
  route();
});

// --- screens ------------------------------------------------------------------------------

/** Signed out: "Email me a sign-in link". The same answer for any address. */
function signInScreen(said = null) {
  const status = h("div", { "aria-live": "polite" }, said);
  const email = h("input", { type: "email", id: "signin-email", autocomplete: "email", required: true, inputmode: "email", spellcheck: "false" });
  const go = h("button", { type: "submit", class: "btn primary", text: "Email me a sign-in link" });
  const form = h("form", { class: "signin" },
    h("label", { for: "signin-email", text: "Your email address" }), email, h("div", { class: "actions" }, go));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    clear(status, busy("Sending…"));
    try {
      const r = await requestLink(email.value);
      clear(status, h("div", { class: "note", role: "status" }, h("p", { text: r.userMessage })));
    } catch (err) {
      clear(status, errorNote(err));
    } finally {
      go.disabled = false;
    }
  });
  const github = githubSigninOn() ? githubBlock(status) : null;
  return [
    h("h1", { text: "Work on your textbook" }),
    h("p", { text: "Bring chapters in from your documents, edit them, answer readers' suggestions, and publish to your readers when you're ready. It all happens here, in the browser, on any computer." }),
    h("p", { text: "Sign in with the email address you were invited at. We email you a link; open it and you're in. No password, and no other account needed." }),
    form,
    status,
    github,
  ];
}

/** While members move from GitHub to email links: the old way in, once, then an address. */
function githubBlock(status) {
  const btn = h("button", { type: "button", class: "btn link", text: "Sign in with GitHub instead" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    clear(status, busy("Waiting for GitHub…"));
    try {
      const r = await signInWithGitHub();
      if (!r) clear(status, h("p", { class: "muted", text: "Sign-in was cancelled." }));
    } catch (err) {
      clear(status, errorNote(err));
    } finally {
      btn.disabled = false;
    }
  });
  return h("p", { class: "muted small" }, "Joined before email sign-in? ", btn);
}

/** Signed in with GitHub and no address yet: asked once. */
function needsEmailScreen() {
  const status = h("div", { "aria-live": "polite" });
  const email = h("input", { type: "email", id: "claim-email", autocomplete: "email", required: true, spellcheck: "false" });
  const form = h("form", {}, h("label", { for: "claim-email", text: "Your email address" }), email, h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Send me a link to confirm it" })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clear(status, busy("Sending…"));
    try {
      await own("/api/me", { method: "POST", body: { email: email.value } });
      clear(status, h("div", { class: "note", role: "status" }, h("p", { text: "Sent. Open the link in that email; from then on you sign in with it." })));
    } catch (err) {
      clear(status, errorNote(err));
    }
  });
  return [
    h("h1", { text: "One more step" }),
    h("p", { text: "Signing in with GitHub is going away. Give the email address you'd like to sign in with from now on; we'll send a link to it to check it's yours." }),
    form,
    status,
    h("p", {}, h("a", { href: "#/", text: "Later: go to your books", onclick: () => { try { sessionStorage.setItem("tb-email-later", "1"); } catch {} } })),
  ];
}

/** #/link/<token>: a sign-in link. Its button uses it, so a mail scanner opening it can't. */
async function linkScreen(token) {
  const status = h("div", { "aria-live": "polite" });
  const go = h("button", { type: "button", class: "btn primary", text: "Sign in" });
  const use = async () => {
    go.disabled = true;
    clear(status, busy("Signing you in…"));
    try {
      await consumeLink(token);
      location.hash = "#/";
    } catch (err) {
      go.disabled = false;
      clear(status, errorNote(err), h("p", {}, h("a", { href: "#/", text: "Ask for a new link" })));
    }
  };
  go.addEventListener("click", use);
  // One press, never on its own: a mail scanner that opens links (some run scripts)
  // must not be the one signed in.
  return [h("h1", { text: "Sign in to the author site" }), h("p", { text: "Press the button to finish signing in on this device." }), h("div", { class: "actions" }, go), status];
}

/** #/invite/<token> and #/claim/<token>: one screen, one button. */
async function invitationScreen(kind, token) {
  let info;
  try {
    info = await invitation(kind, token);
  } catch (err) {
    return [h("h1", { text: kind === "invite" ? "This invitation has expired" : "This link has expired" }), errorNote(err), h("p", {}, h("a", { href: "#/", text: "Sign in" }))];
  }
  const status = h("div", { "aria-live": "polite" });
  if (kind === "claim") {
    const go = h("button", { type: "button", class: "btn primary", text: "Use this address" });
    go.addEventListener("click", async () => {
      go.disabled = true;
      clear(status, busy("Confirming…"));
      try {
        await acceptInvitation("claim", token);
        location.hash = "#/";
      } catch (err) {
        go.disabled = false;
        clear(status, errorNote(err));
      }
    });
    return [h("h1", { text: "Confirm your email address" }), h("p", { text: `${info.name}, you'll sign in to the author site with ${info.email} from now on.` }), h("div", { class: "actions" }, go), status];
  }
  const name = h("input", { type: "text", id: "credit-name", value: info.name, autocomplete: "name", maxlength: "80", required: true });
  const form = h("form", {},
    h("label", { for: "credit-name", text: "Your name as it appears in the book's credits" }), name,
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Continue" })));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clear(status, busy("Joining…"));
    try {
      const r = await acceptInvitation("invite", token, name.value);
      if (r.joined !== false) return (location.hash = `#/${r.book}`);
      // A copied invitation: the inbox proves it's them, so the invitation comes again by email.
      form.remove();
      clear(status, h("p", { text: r.emailed
        ? `One more step: we've emailed this invitation to ${info.email ?? "the address you were invited at"}. Open it there to join ${info.title}.`
        : `The invitation couldn't be emailed to ${info.email ?? "the address you were invited at"} just now. Ask whoever invited you to send it again.` }));
    } catch (err) {
      clear(status, errorNote(err));
    }
  });
  return [h("h1", { text: `Join ${info.title}` }), h("p", { class: "muted", text: `${info.inviter} invited you to work on it.` }), form, status];
}

const ROUTES = [
  [/^$/, () => booksScreen()],
  [/^settings$/, () => settingsScreen()],
  [/^([a-z0-9-]+)$/, (book) => chaptersScreen(book)],
  [/^([a-z0-9-]+)\/chapter\/(.+)$/, (book, path) => chapterScreen(book, decodeURIComponent(path))],
  [/^([a-z0-9-]+)\/edit\/([^/]+)(?:\/line\/(\d+))?$/, (book, path, line) => editScreen(book, decodeURIComponent(path), line ? Number(line) : null)],
  [/^([a-z0-9-]+)\/tidy\/(.+)$/, (book, path) => tidyScreen(book, decodeURIComponent(path))],
  [/^([a-z0-9-]+)\/tidy-all\/(glossary|concepts)(?:\/(\d+))?$/, (book, kind, n) => tidyAllScreen(book, kind, n ? Number(n) : 0)],
  [/^([a-z0-9-]+)\/import$/, (book) => importScreen(book)],
  [/^([a-z0-9-]+)\/new\/chapter$/, (book) => newChapterScreen(book)],
  [/^([a-z0-9-]+)\/new\/concept$/, (book) => newConceptScreen(book)],
  [/^([a-z0-9-]+)\/(?:drafts|waiting|publish|change\/\d+)$/, (book) => draftsScreen(book)],
  [/^([a-z0-9-]+)\/suggestion\/(\d+)$/, (book, n) => suggestionScreen(book, Number(n))],
  [/^([a-z0-9-]+)\/people$/, (book) => peopleScreen(book)],
  [/^([a-z0-9-]+)\/credits(?:\/(.+))?$/, (book, path) => creditsScreen(book, path ? decodeURIComponent(path) : "")],
  [/^([a-z0-9-]+)\/history(?:\/(.+))?$/, (book, path) => historyScreen(book, path ? decodeURIComponent(path) : "")],
  [/^([a-z0-9-]+)\/revision\/([0-9a-f]{40})(?:\/(.+))?$/, (book, sha, path) => revisionScreen(book, sha, path ? decodeURIComponent(path) : "")],
];

let seq = 0;
const OPEN_ROUTES = [
  [/^link\/([A-Za-z0-9_-]{43})$/, (t) => linkScreen(t)],
  [/^invite\/([A-Za-z0-9_-]{43})$/, (t) => invitationScreen("invite", t)],
  [/^claim\/([A-Za-z0-9_-]{43})$/, (t) => invitationScreen("claim", t)],
];

async function route() {
  const mine = ++seq;
  const path = location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
  const open = OPEN_ROUTES.map(([re, fn]) => [re.exec(path), fn]).find(([m]) => m);
  if (open) {
    const nodes = await open[1](...open[0].slice(1));
    if (mine === seq) clear(main, ...[nodes].flat());
    return;
  }
  if (!identity()) {
    clear(main, ...signInScreen());
    return;
  }
  let later = false;
  try {
    later = sessionStorage.getItem("tb-email-later") === "1";
  } catch {}
  if (!identity().email && path === "" && !later) {
    clear(main, ...needsEmailScreen());
    return;
  }
  const match = ROUTES.map(([re, fn]) => [re.exec(path), fn]).find(([m]) => m);
  if (!match) {
    location.hash = "#/";
    return;
  }
  clear(main, busy("Loading…"));
  try {
    const nodes = await match[1](...match[0].slice(1));
    if (mine !== seq) return; // the author has already moved on
    clear(main, ...[nodes].flat());
    const h1 = main.querySelector("h1");
    if (h1) document.title = `${h1.textContent} · Author site`;
    main.focus({ preventScroll: true });
  } catch (err) {
    if (mine !== seq) return;
    if (err.status === 401) return; // signed out: onChange draws the sign-in screen
    clear(main, h("h1", { text: "That didn't work" }), errorNote(err), h("p", {}, h("a", { href: "#/", text: "Back to your books" })));
  }
}

window.addEventListener("hashchange", route);
loadMe(); // draws the first screen when it knows who this is

privacyNote();
