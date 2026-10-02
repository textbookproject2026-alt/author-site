// The author site: everything an author does after their book is set up, in the
// browser. Plain ES modules, no framework and no build step: a handful of screens,
// each drawn from what the author endpoints say, with every change made through them.
//
// Routes (the hash, so a static host serves one page):
//   #/                          your books
//   #/<book>                    its chapters
//   #/<book>/chapter/<path>     one chapter
//   #/<book>/edit/<path>        edit it
//   #/<book>/tidy/<path>        its citations, concept links and glossary questions
//   #/<book>/import             bring in a Word document
//   #/<book>/waiting            suggestions, draft changes, going live, jobs
//   #/<book>/suggestion/<n>     one reader suggestion
//   #/<book>/change/<n>         one draft change
//   #/<book>/publish            send the drafts to the live book
//   #/<book>/people             who can work on it; invite, remove
//   #/<book>/history[/<path>]   the drafts' history, of the book or one page
//   #/<book>/revision/<sha>[/<path>]  one change; one page at it, and Restore
//   #/settings                  the author's own DeepSeek key, in this browser

import { h, clear, busy, errorNote } from "./lib/dom.js";
import { identity, onChange, signIn, signOut } from "./lib/auth.js";
import { booksScreen, chaptersScreen, chapterScreen } from "./lib/screens-books.js";
import { importScreen } from "./lib/screens-import.js";
import { tidyScreen } from "./lib/screens-tidy.js";
import { editScreen } from "./lib/screens-edit.js";
import { settingsScreen } from "./lib/screens-settings.js";
import { peopleScreen } from "./lib/screens-people.js";
import { historyScreen, revisionScreen } from "./lib/screens-history.js";
import { waitingScreen, suggestionScreen, changeScreen, publishScreen } from "./lib/screens-waiting.js";

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

const who = document.getElementById("who");
function showWho(id) {
  if (!id) {
    who.hidden = true;
    clear(who);
    return;
  }
  clear(who,
    id.id ? h("img", { src: `https://avatars.githubusercontent.com/u/${id.id}?s=44`, alt: "" }) : null,
    h("span", { text: `@${id.login}` }),
    h("a", { class: "btn link", href: "#/settings", text: "Settings" }),
    h("button", { type: "button", class: "btn link", text: "Sign out", onclick: () => signOut() }));
  who.hidden = false;
}
onChange((id) => {
  showWho(id);
  route();
});
showWho(identity());

// --- screens ------------------------------------------------------------------------------

function signInScreen() {
  const status = h("div", { "aria-live": "polite" });
  const go = h("button", { type: "button", class: "btn primary", text: "Sign in with GitHub" });
  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(status, busy("Waiting for GitHub…"));
    try {
      const id = await signIn();
      if (!id) clear(status, h("p", { class: "muted", text: "Sign-in was cancelled. Press the button to try again." }));
    } catch (err) {
      clear(status, errorNote(err));
    } finally {
      go.disabled = false;
    }
  });
  return [
    h("h1", { text: "Work on your textbook" }),
    h("p", { text: "Bring chapters in from Word, answer readers' suggestions, accept draft changes, and send the drafts to your readers when they're ready. It all happens here, in the browser, on any computer." }),
    h("p", { text: "Sign in with the GitHub account the book was set up for. The author site learns only who you are: it gets no access to your GitHub account, and keeps nothing on this computer after you close the tab." }),
    h("div", { class: "actions" }, go),
    status,
  ];
}

const ROUTES = [
  [/^$/, () => booksScreen()],
  [/^settings$/, () => settingsScreen()],
  [/^([a-z0-9-]+)$/, (book) => chaptersScreen(book)],
  [/^([a-z0-9-]+)\/chapter\/(.+)$/, (book, path) => chapterScreen(book, decodeURIComponent(path))],
  [/^([a-z0-9-]+)\/edit\/(.+)$/, (book, path) => editScreen(book, decodeURIComponent(path))],
  [/^([a-z0-9-]+)\/tidy\/(.+)$/, (book, path) => tidyScreen(book, decodeURIComponent(path))],
  [/^([a-z0-9-]+)\/import$/, (book) => importScreen(book)],
  [/^([a-z0-9-]+)\/waiting$/, (book) => waitingScreen(book)],
  [/^([a-z0-9-]+)\/suggestion\/(\d+)$/, (book, n) => suggestionScreen(book, Number(n))],
  [/^([a-z0-9-]+)\/change\/(\d+)$/, (book, n) => changeScreen(book, Number(n))],
  [/^([a-z0-9-]+)\/publish$/, (book) => publishScreen(book)],
  [/^([a-z0-9-]+)\/people$/, (book) => peopleScreen(book)],
  [/^([a-z0-9-]+)\/history(?:\/(.+))?$/, (book, path) => historyScreen(book, path ? decodeURIComponent(path) : "")],
  [/^([a-z0-9-]+)\/revision\/([0-9a-f]{40})(?:\/(.+))?$/, (book, sha, path) => revisionScreen(book, sha, path ? decodeURIComponent(path) : "")],
];

let seq = 0;
async function route() {
  const mine = ++seq;
  const path = location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (!identity()) {
    clear(main, ...signInScreen());
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
route();
