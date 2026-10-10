// The author endpoints (suggest-edit-function's api/author-*.js), through this site's
// own server (/fn/<endpoint>, batch 2b): the session cookie goes with each call and
// the server vouches for the member upstream. A 401 means the session has ended
// (signed out elsewhere, removed from the book): the page asks to sign in again.

import { signedOut } from "./auth.js";

export const apiBase = () => document.querySelector('meta[name="tb-api"]')?.content ?? "";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.userMessage || body?.error || `The author site's server answered ${status}.`);
    this.status = status;
    this.body = body ?? {};
    this.userMessage = body?.userMessage || (status === 0
      ? "The author site couldn't be reached. Check you're online, then try again."
      : "Something went wrong. Nothing was changed. Please try again.");
  }
}

async function call(endpoint, { method = "GET", query, body } = {}) {
  const url = new URL(`/fn/${endpoint}`, location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "x-author-site": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, null);
  }
  let payload = {};
  try {
    payload = await res.json();
  } catch {
    /* not JSON: the status says enough */
  }
  if (res.status === 401) {
    signedOut();
    throw new ApiError(401, payload);
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const read = (what, query = {}) => call("author-read", { query: { what, ...query } });
export const send = (body) => call("author-send", { method: "POST", body });
export const act = (book, action, extra = {}) => call("author-act", { method: "POST", body: { book, action, ...extra } });
// The book goes with each part only so this site's server can check you're on it.
export const importPart = (book, part) => call("author-import", { method: "POST", body: { book, part } });
export const importStart = (body) => call("author-import", { method: "POST", body: { action: "start", ...body } });
export const importAgain = (book, id) => call("author-import", { method: "POST", body: { action: "again", book, id } });
export const importStatus = (book, id, file) => call("author-import", { query: { book, id, file } });
export const history = (book, query = {}) => call("author-history", { query: { book, ...query } });
/**
 * What is proposed for the book (or one page): open proposed edits, notes and
 * suggestions, from the function's public /api/history, the same the book's readers
 * see in Page history. No sign-in; [] when it can't be had.
 */
/** A declined proposal's change (batch 2c), from the function's public /api/history: { files: [{ path, before, after }] }. */
export async function declinedChange(book, number) {
  const url = new URL("history", apiBase());
  url.searchParams.set("book", book);
  url.searchParams.set("change", String(number));
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data ?? { userMessage: "What was proposed couldn't be loaded just now." });
  return data;
}

export async function proposed(book, path) {
  try {
    const url = new URL("history", apiBase());
    url.searchParams.set("book", book);
    if (path) url.searchParams.set("path", path);
    const res = await fetch(url);
    const items = res.ok ? (await res.json())?.items : null;
    return Array.isArray(items) ? items.filter((i) => i && Number.isInteger(i.number)) : [];
  } catch {
    return [];
  }
}
