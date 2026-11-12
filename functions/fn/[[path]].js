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
import { audit, bookEntry, booksOf, fail, json, now, onBook, sameSite, session, upstream } from "../_lib/core.js";

/** Endpoint -> the methods forwarded. */
const ROUTES = {
  "author-read": ["GET"],
  "author-history": ["GET"],
  "author-import": ["GET", "POST"],
  "author-send": ["POST"],
  "author-act": ["POST"],
  // A write's answer from the fallback (worker/writes.mjs), asked for by key.
  "write-status": ["GET"],
};
/**
 * The platform maintainer's test books (suggest-edit-function api/maintainer.js), for no
 * book in particular: the function decides who is a maintainer (MAINTAINER_MEMBER_IDS)
 * and answers 403 to anyone else; this site only adds a made book's maintainer to it,
 * and takes a removed book's people off it, once the function has said yes.
 */
const MAINTAINER = /^maintainer\/test-books(?:\/([a-z0-9-]{1,80})\/remove)?$/;
const methodsOf = (endpoint) => (Object.hasOwn(ROUTES, endpoint) ? ROUTES[endpoint] : MAINTAINER.exec(endpoint) ? (MAINTAINER.exec(endpoint)[1] ? ["POST"] : ["GET", "POST"]) : null);

/** Word imports go up in parts of a few MB each (the function's own limit is lower). */
const MAX_BODY = 6 * 1024 * 1024;

export async function onRequest({ request, env, params, waitUntil }) {
  const endpoint = [params.path ?? []].flat().join("/");
  if (!methodsOf(endpoint)?.includes(request.method)) return fail(404, "not found");
  if (!sameSite(request)) return fail(403, "cross-site request");
  const maintainer = MAINTAINER.exec(endpoint);
  const s = await session(request, env);
  if (!s) return maintainer ? fail(403, "forbidden") : fail(401, "signed out", "Please sign in again.");

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
  // books (author-read?what=books) and the maintainer's endpoints are for no book.
  const book = maintainer ? "" : request.method === "GET" ? url.searchParams.get("book") ?? "" : typeof parsed.book === "string" ? parsed.book : "";
  const bookless = endpoint === "author-read" && request.method === "GET" && url.searchParams.get("what") === "books" && !book;
  if (maintainer) {
    // Any member may ask; the function says no (403) to all but the maintainers. No
    // `book` in the body: the function would read the request as for that book.
    if (request.method !== "GET" && typeof parsed.book === "string") return fail(400, "bad body");
  } else if (bookless) {
    // On no book (removed from the last one, or a test book removed): an empty list.
    if (!(await booksOf(env, s.member.id)).length) return json({ login: `m-${s.member.id}`, books: [] });
  } else if (!(await onBook(env, s.member.id, book))) {
    return fail(403, "not on this book", "You aren't one of this book's people.");
  }

  if (Math.random() < 0.02) waitUntil(env.DB.prepare("DELETE FROM assertions WHERE expires_at < ?").bind(now() - 3_600_000).run());
  let res;
  try {
    res = await upstream(env, s.member.id, { method: request.method, endpoint, params: url.searchParams, bodyText, book });
  } catch {
    console.error(`fn: ${endpoint} upstream unreachable`);
    return fail(502, "upstream", "The author site's server couldn't be reached. Nothing was changed.");
  }

  if (maintainer && res.ok && request.method === "POST") {
    const answer = await res.clone().json().catch(() => null);
    if (maintainer[1] && res.status === 202) await forgetBook(env, maintainer[1]);
    else if (!maintainer[1] && res.status === 201 && typeof answer?.slug === "string" && /^test-[a-z0-9-]{1,75}$/.test(answer.slug)) {
      // The maintainer is on the new book here at once: it is in their list as soon as
      // the registry has it, and they can invite people to it before its first build.
      await env.DB.prepare("INSERT OR IGNORE INTO book_members (book, member_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(answer.slug, s.member.id, s.member.id, now()).run();
      await audit(env, answer.slug, s.member, "joined", s.member.display_name);
    }
  }
  if (endpoint === "author-act" && parsed?.action === "publish" && res.ok) {
    const entry = await bookEntry(book).catch(() => null);
    waitUntil(audit(env, book, s.member, "published", entry?.title ?? book));
  }
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of ["content-type", "x-registry-version", "x-function-version", "retry-after"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status >= 300 && res.status < 400 ? 502 : res.status, headers: out });
}

/**
 * A test book is being removed (the function said yes): everyone on it loses access at
 * once (their next request for it is refused here and in the assertion read-back), its
 * pending invitations stop working ("no longer valid"), and its log goes. Accounts
 * stay: someone on no other book still signs in to an empty list until their sign-in
 * ends, and then their email is deleted (core.js prune).
 */
export async function forgetBook(env, slug) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM book_members WHERE book = ?").bind(slug),
    env.DB.prepare("DELETE FROM links WHERE book = ? AND kind = 'invite'").bind(slug),
    env.DB.prepare("DELETE FROM assertions WHERE book = ?").bind(slug),
    env.DB.prepare("DELETE FROM audit WHERE book = ?").bind(slug),
    env.DB.prepare("DELETE FROM notified WHERE book = ?").bind(slug),
  ]);
}
