// The author endpoints (suggest-edit-function's api/author-*.js). Every call carries
// the identity token; a 401 means it has expired or isn't for this page, and signs
// the author out so the page asks them to sign in again.

import { identity, signOut } from "./auth.js";

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
  const id = identity();
  if (!id) {
    signOut();
    throw new ApiError(401, { userMessage: "Please sign in with GitHub again." });
  }
  const url = new URL(endpoint, apiBase());
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${id.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
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
    signOut();
    throw new ApiError(401, payload);
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const read = (what, query = {}) => call("author-read", { query: { what, ...query } });
export const send = (body) => call("author-send", { method: "POST", body });
export const act = (book, action, extra = {}) => call("author-act", { method: "POST", body: { book, action, ...extra } });
export const importPart = (part) => call("author-import", { method: "POST", body: { part } });
export const importStart = (body) => call("author-import", { method: "POST", body: { action: "start", ...body } });
export const importAgain = (book, id) => call("author-import", { method: "POST", body: { action: "again", book, id } });
export const importStatus = (book, id, file) => call("author-import", { query: { book, id, file } });
export const people = (book) => call("author-people", { query: { book } });
export const changePeople = (book, action, login) => call("author-people-change", { method: "POST", body: { book, action, login } });
export const history = (book, query = {}) => call("author-history", { query: { book, ...query } });
