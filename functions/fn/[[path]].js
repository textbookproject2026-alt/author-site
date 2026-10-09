// /fn/<endpoint> — the suggest-edit function's author endpoints, for a member signed
// in here (batch 2b). Not an open proxy:
//   - one upstream, hard-coded (UPSTREAM); nothing in the request picks a host or a
//     path prefix;
//   - only the endpoints and methods in ROUTES; anything else is 404;
//   - a valid session, and the member on the book the request is for (checked
//     against book_members here, and again when the function reads the assertion
//     back), before anything is forwarded;
//   - the browser's headers are not forwarded: the request upstream carries only a
//     content type, this site's origin, and "Authorization: Member <id>" (never the
//     session cookie, never an X-* header);
//   - the assertion is single-use, expires in a minute, is stored hashed and is bound
//     to the member, the book, the method, the endpoint, the query and a hash of the
//     body; the function reads it back once (/api/internal/assertion), which marks it
//     used.
// Publishing is written to the audit log (member, book, time). Bodies are never logged.
import {
  ASSERTION_SECONDS, SITE, UPSTREAM, audit, bindingOf, bookEntry, booksOf, fail, hash, now, onBook, randomToken, sameSite, session,
} from "../_lib/core.js";

/** Endpoint -> the methods forwarded. */
const ROUTES = {
  "author-read": ["GET"],
  "author-history": ["GET"],
  "author-import": ["GET", "POST"],
  "author-send": ["POST"],
  "author-act": ["POST"],
};
/** Word imports go up in parts of a few MB each (the function's own limit is lower). */
const MAX_BODY = 6 * 1024 * 1024;

export async function onRequest({ request, env, params, waitUntil }) {
  const segments = [params.path ?? []].flat();
  const endpoint = segments.length === 1 ? segments[0] : "";
  if (!Object.hasOwn(ROUTES, endpoint) || !ROUTES[endpoint].includes(request.method)) return fail(404, "not found");
  if (!sameSite(request)) return fail(403, "cross-site request");
  const s = await session(request, env);
  if (!s) return fail(401, "signed out", "Please sign in again.");

  const url = new URL(request.url);
  let bodyText = "";
  let parsed = null;
  if (request.method !== "GET") {
    const len = Number(request.headers.get("content-length") ?? 0);
    if (len > MAX_BODY) return fail(413, "too large", "That's too large to send in one go.");
    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, "too large", "That's too large to send in one go.");
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, "bad body");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "bad body");
    // Forwarded exactly as the function will re-serialise what it parses, so both
    // sides hash the same text.
    bodyText = JSON.stringify(parsed);
  }

  // Which book: the query's for GET, the body's otherwise. Only the list of one's own
  // books (author-read?what=books) is for no book in particular.
  const book = request.method === "GET" ? url.searchParams.get("book") ?? "" : typeof parsed.book === "string" ? parsed.book : "";
  const bookless = endpoint === "author-read" && request.method === "GET" && url.searchParams.get("what") === "books" && !book;
  if (bookless) {
    if (!(await booksOf(env, s.member.id)).length) return fail(403, "not on a book", "You aren't on any book yet.");
  } else if (!(await onBook(env, s.member.id, book))) {
    return fail(403, "not on this book", "You aren't one of this book's people.");
  }

  const id = randomToken();
  const binding = await bindingOf({ method: request.method, endpoint, params: url.searchParams, bodyText, book });
  await env.DB.prepare("INSERT INTO assertions (id_hash, member_id, book, binding_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await hash(id), s.member.id, book, binding, now() + ASSERTION_SECONDS * 1000)
    .run();
  if (Math.random() < 0.02) waitUntil(env.DB.prepare("DELETE FROM assertions WHERE expires_at < ?").bind(now() - 3_600_000).run());

  const headers = { authorization: `Member ${id}`, origin: SITE, accept: "application/json" };
  if (request.method !== "GET") headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(`${UPSTREAM}/api/${endpoint}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : bodyText,
      redirect: "manual",
    });
  } catch {
    console.error(`fn: ${endpoint} upstream unreachable`);
    return fail(502, "upstream", "The author site's server couldn't be reached. Nothing was changed.");
  }

  if (endpoint === "author-act" && parsed?.action === "publish" && res.ok) {
    const entry = await bookEntry(book).catch(() => null);
    waitUntil(audit(env, book, s.member.display_name, "published", entry?.title ?? book));
  }
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of ["content-type", "x-registry-version", "x-function-version", "retry-after"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status >= 300 && res.status < 400 ? 502 : res.status, headers: out });
}
