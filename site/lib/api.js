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

// Writes (suggest-edit-function worker/writes.mjs): each POST carries a key from this page
// load and the body, so the same thing sent twice is one write. If the API can't finish
// it (its CPU limit, Cloudflare's 1102, or any 5xx), the same request and key go again
// with &fallback=, a GitHub Actions job does the write, and the page asks for the answer
// (/fn/write-status) while it says so.
export const WAIT_MESSAGE = "Saving… this can take up to a minute.";
export const timing = { pollMs: 3000, waitMs: 3 * 60_000 };
const PAGE = Math.random().toString(36).slice(2) + Date.now().toString(36);

async function keyOf(endpoint, text) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${PAGE}\n${endpoint}\n${text}`)));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Saving… this can take up to a minute", at the foot of the page, while a fallback runs. */
function waiting(on) {
  let n = document.getElementById("write-wait");
  if (!n && on) {
    n = document.createElement("div");
    n.id = "write-wait";
    n.className = "write-wait";
    n.setAttribute("role", "status");
    document.body.append(n);
  }
  if (n) {
    n.textContent = on ? WAIT_MESSAGE : "";
    n.hidden = !on;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(url, method, text) {
  return fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "x-author-site": "1", ...(text ? { "Content-Type": "application/json" } : {}) },
    body: text,
  });
}

/** A write that failed (or is still running): queue it, then wait for its answer. */
async function fallback(url, text, book, res) {
  waiting(true);
  try {
    const key = url.searchParams.get("write_key");
    if (!res || res.status >= 500) {
      const q = new URL(url);
      q.searchParams.set("fallback", res ? String(res.status) : "network");
      const queued = await once(q, "POST", text);
      if (queued.status !== 202) return queued;
    }
    const status = new URL("/fn/write-status", location.origin);
    status.searchParams.set("book", book);
    status.searchParams.set("write_key", key);
    const start = Date.now();
    while (Date.now() - start < timing.waitMs) {
      await sleep(timing.pollMs);
      const r = await once(status, "GET").catch(() => null);
      if (r && r.status !== 202) return r;
    }
    return new Response(JSON.stringify({ error: "timeout", userMessage: "This is taking longer than it should. Nothing you wrote is lost: reload in a few minutes to see if it went in." }), { status: 504 });
  } finally {
    waiting(false);
  }
}

async function call(endpoint, { method = "GET", query, body } = {}) {
  const url = new URL(`/fn/${endpoint}`, location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const text = body ? JSON.stringify(body) : undefined;
  const write = method === "POST";
  if (write) url.searchParams.set("write_key", await keyOf(endpoint, text ?? ""));
  let res = null;
  try {
    res = await once(url, method, text);
  } catch {
    if (!write) res = null;
  }
  // A read that died on the way (the API's CPU limit, a dropped connection) is tried
  // once more before anyone is told: reads change nothing, and one retry clears most.
  if (!write && (!res || res.status >= 500)) {
    try {
      res = await once(url, method, text);
    } catch {
      throw new ApiError(0, null);
    }
  }
  if (write && (!res || res.status >= 500 || res.status === 202)) {
    try {
      res = await fallback(url, text, body?.book ?? "", res);
    } catch {
      throw new ApiError(0, null);
    }
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
/**
 * A declined proposal's change (batch 2c): { files: [{ path, before, after }] }.
 * Through this site's proxy, not the function's public endpoint: a browser can be
 * stopped by the host's bot checks there, the site's own server isn't.
 */
export const declinedChange = (book, number) => read("declined-change", { book, number: String(number) });

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
