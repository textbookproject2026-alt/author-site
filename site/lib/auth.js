// Signing in: the same GitHub sign-in the books' in-site editor uses.
//
// The function's /api/github-auth runs GitHub's consent page in a popup, asks GitHub
// who this is, throws GitHub's token away at once, and hands this page an identity
// token bound to this page's origin. That token proves who the author is to the
// author endpoints and nothing else; no GitHub token is kept anywhere.
//
// It lives in sessionStorage: gone when the tab closes, never shared with another
// site, and the function refuses it after eight hours anyway.

import { apiBase } from "./api.js";

const KEY = "tb-author-identity";
const TTL_MS = 8 * 60 * 60 * 1000;
const listeners = new Set();

export function identity() {
  try {
    const id = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (id && typeof id.token === "string" && Date.now() - id.at < TTL_MS - 60_000) return id;
  } catch {
    /* storage blocked or garbled: signed out */
  }
  return null;
}

function save(id) {
  try {
    if (id) sessionStorage.setItem(KEY, JSON.stringify(id));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: this tab only remembers until reload */
  }
  for (const fn of listeners) fn(id);
}

export const onChange = (fn) => listeners.add(fn);
export const signOut = () => save(null);

/**
 * Opens GitHub's sign-in in a popup. Resolves to the identity, or null if the author
 * closed it or said no; rejects if the popup was blocked.
 */
export function signIn() {
  const fnOrigin = new URL(apiBase()).origin;
  const url = `${apiBase()}github-auth?origin=${encodeURIComponent(location.origin)}`;
  const popup = window.open(url, "tb-github-signin", "popup,width=560,height=720");
  if (!popup) return Promise.reject(new Error("Your browser blocked the sign-in window. Allow pop-ups for this site and try again."));
  return new Promise((resolve) => {
    const done = (value) => {
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      resolve(value);
    };
    const onMessage = (e) => {
      if (e.origin !== fnOrigin) return;
      const d = e.data;
      if (!d || d.type !== "tb-github-identity") return;
      if (d.error || typeof d.token !== "string" || typeof d.login !== "string") return done(null);
      const id = { token: d.token, login: d.login, id: Number(d.id) || 0, name: d.name ?? "", at: Date.now() };
      save(id);
      done(id);
    };
    window.addEventListener("message", onMessage);
    const watch = setInterval(() => {
      if (popup.closed) setTimeout(() => done(identity()), 300);
    }, 500);
  });
}
