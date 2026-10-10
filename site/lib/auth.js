// Who is signed in (batch 2b): members sign in with an emailed link; the session is
// an HttpOnly cookie this page can't read, and /api/me says who it belongs to. The
// GitHub sign-in stays only while members move to email links (the server switches
// it off): the function's popup proves the GitHub account, and the author site's
// own server turns that into the same kind of session.

import { apiBase } from "./api.js";

let me = null; // { id, name, email, github, notify, maintainer, books }
let githubSignin = false;
const listeners = new Set();

/** The member signed in, as /api/me last said, or null. */
export const identity = () => me;
export const githubSigninOn = () => githubSignin;
export const onChange = (fn) => listeners.add(fn);
const changed = () => {
  for (const fn of listeners) fn(me);
};

/** The site's own endpoints: same origin, the session cookie, the header that marks the site's own requests. */
export async function own(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "x-author-site": "1", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("offline"), { status: 0, userMessage: "The author site couldn't be reached. Check you're online, then try again." });
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(payload.error ?? String(res.status)), { status: res.status, body: payload, userMessage: payload.userMessage || "Something went wrong. Please try again." });
  return payload;
}

/** Asks the server who this is; updates everyone listening. */
export async function loadMe() {
  const d = await own("/api/me").catch(() => ({ member: null }));
  githubSignin = d.githubSignin !== false;
  me = d.member ? { ...d.member, books: d.books ?? [] } : null;
  changed();
  return me;
}

/** This page was told the session is gone (a 401): signed out here, no call needed. */
export function signedOut() {
  if (!me) return;
  me = null;
  changed();
}

export async function signOut(everywhere = false) {
  await own("/api/auth/signout", { method: "POST", body: { everywhere } }).catch(() => {});
  me = null;
  changed();
}

export const requestLink = (email) => own("/api/auth/request", { method: "POST", body: { email } });

export async function consumeLink(token) {
  await own("/api/auth/consume", { method: "POST", body: { token } });
  return loadMe();
}

export const invitation = (kind, token) => own("/api/invite", { method: "POST", body: { kind, token, action: "info" } });
export async function acceptInvitation(kind, token, name) {
  const out = await own("/api/invite", { method: "POST", body: { kind, token, action: "accept", ...(name ? { name } : {}) } });
  if (out.joined !== false) await loadMe();
  return out;
}

/**
 * GitHub, for members who haven't moved to email yet: the function's popup proves the
 * account (an identity token bound to this page), then the server signs them in.
 * Resolves to { needsEmail } or null if the popup was closed.
 */
export function signInWithGitHub() {
  const fnOrigin = new URL(apiBase()).origin;
  const popup = window.open(`${apiBase()}github-auth?origin=${encodeURIComponent(location.origin)}`, "tb-github-signin", "popup,width=560,height=720");
  if (!popup) return Promise.reject(Object.assign(new Error("popup"), { userMessage: "Your browser blocked the sign-in window. Allow pop-ups for this site and try again." }));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      fn();
    };
    const onMessage = (e) => {
      if (e.origin !== fnOrigin || e.data?.type !== "tb-github-identity") return;
      if (e.data.error || typeof e.data.token !== "string") return done(() => resolve(null));
      done(() =>
        own("/api/auth/github", { method: "POST", body: { token: e.data.token } })
          .then(async (r) => {
            await loadMe();
            resolve(r);
          })
          .catch(reject),
      );
    };
    window.addEventListener("message", onMessage);
    const watch = setInterval(() => {
      if (popup.closed) setTimeout(() => done(() => resolve(null)), 300);
    }, 500);
  });
}
