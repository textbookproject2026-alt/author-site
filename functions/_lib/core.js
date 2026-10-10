// The author site's backend (Cloudflare Pages Functions, batch 2b): helpers every
// endpoint shares. Plain Web APIs only (fetch, crypto.subtle, D1). Request bodies
// and tokens are never logged.

/** The suggest-edit function, production. The only upstream; never from a request. */
export const UPSTREAM = "https://suggest-edit-function.vercel.app";
/** This site in production: links in emails, and what the function reads back from. */
export const SITE = "https://author.confused4now.org";

export const SESSION_COOKIE = "__Host-tb_session";
export const SESSION_DAYS = 30;
export const SIGNIN_MINUTES = 15;
export const LINK_DAYS = 7;
export const ASSERTION_SECONDS = 60;
const DAY = 86_400_000;

export const now = () => Date.now();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      ...headers,
    },
  });
}
export const fail = (status, error, userMessage) => json(userMessage ? { error, userMessage } : { error }, status);

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A secret for a link, a cookie or an assertion: 32 random bytes, URL-safe (43 characters). */
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** A member id: 10 lower-case hex digits ("m-<id>" outside this database). */
export const memberId = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, "0")).join("");
/** SHA-256, hex. Tokens are stored only as this. */
export async function hash(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Emails are compared lower-cased and trimmed. */
export const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e) =>
  typeof e === "string" && e.length <= 254 && /^[^\s@<>()",;:\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(e);
/** A display name: one line, no control characters, trimmed, at most 80 characters, no "@" (the registry is public). */
export const cleanName = (n) =>
  String(n ?? "")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    // Invisible and direction-changing characters (all of Unicode's "format" class, and
    // variation selectors): a name must read as it is (it is public).
    .replace(/[\p{Cf}\u034f\u180b-\u180f\ufe00-\ufe0f]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@/g, "")
    .slice(0, 80);
export const memberNoreply = (id) => `m-${id}@users.noreply.confused4now.org`;

const MAX_JSON = 64 * 1024;
/** A small JSON body (the site's own forms), or {}. */
export async function body(request) {
  try {
    const text = await request.text();
    if (text.length > MAX_JSON) return {};
    const b = JSON.parse(text);
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

/**
 * Every request that changes something, and every proxied one, comes from this
 * site's own pages: the same origin (the Origin header, which browsers set on
 * POST and on fetches) and the header the site's fetch adds, which a form or an
 * image on another site can't send. With the SameSite=Lax cookie, that is the CSRF
 * protection.
 */
export function sameSite(request) {
  if (request.headers.get("x-author-site") !== "1") return false;
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  // Browsers leave Origin off a same-origin GET; Fetch Metadata says where it came from.
  return (request.method === "GET" || request.method === "HEAD") && request.headers.get("sec-fetch-site") === "same-origin";
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
export const sessionCookie = (token, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

/** A new session for a member: the Set-Cookie header value. */
export async function startSession(env, id) {
  const token = randomToken();
  const t = now();
  await env.DB.prepare("INSERT INTO sessions (id_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await hash(token), id, t, t + SESSION_DAYS * DAY)
    .run();
  return sessionCookie(token, SESSION_DAYS * 86_400);
}

/** The signed-in member, or null: { member, sessionHash }. Expired sessions don't count. */
export async function session(request, env) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token || !TOKEN_RE.test(token)) return null;
  const sessionHash = await hash(token);
  const member = await env.DB.prepare(
    "SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.id_hash = ? AND s.expires_at > ?",
  )
    .bind(sessionHash, now())
    .first();
  return member ? { member, sessionHash } : null;
}

export async function booksOf(env, id) {
  const { results } = await env.DB.prepare("SELECT book FROM book_members WHERE member_id = ? ORDER BY book").bind(id).all();
  return results.map((r) => r.book);
}
export async function onBook(env, id, book) {
  if (typeof book !== "string" || !book) return false;
  return !!(await env.DB.prepare("SELECT 1 AS x FROM book_members WHERE member_id = ? AND book = ?").bind(id, book).first());
}

/** One line of a book's People log. `actor` is a member row ({ id, display_name }) or a name. */
export async function audit(env, book, actor, action, subjectName) {
  const id = typeof actor === "object" && actor ? actor.id : null;
  const name = typeof actor === "object" && actor ? actor.display_name : String(actor);
  await env.DB.prepare("INSERT INTO audit (book, at, actor_id, actor_name, action, subject_name) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(book, now(), id, name, action, subjectName)
    .run();
}

/** At most `limit` uses of `key` per window of `seconds`; true when this one is allowed. */
export async function allow(env, key, limit, seconds) {
  const window = Math.floor(now() / (seconds * 1000));
  const row = await env.DB.prepare(
    "INSERT INTO rate (key, window, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(key, window) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(key, window, (window + 1) * seconds * 1000)
    .first();
  return (row?.count ?? 1) <= limit;
}

/** The registry, public (raw GitHub), cached for a minute in this isolate. */
let registryCache = null;
export async function registry() {
  if (registryCache && now() - registryCache.at < 60_000) return registryCache.data;
  const res = await fetch("https://raw.githubusercontent.com/textbookproject2026-alt/textbook-registry/main/registry.json", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`registry: HTTP ${res.status}`);
  const data = await res.json();
  registryCache = { at: now(), data };
  return data;
}
/** A registered book that isn't retired, or null. */
export async function bookEntry(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null;
  const r = await registry();
  return r.books.find((b) => b.slug === slug && b.status !== "retired") ?? null;
}

/** Whether a member is the platform's maintainer (the GitHub login in PLATFORM_OWNER). */
export const isMaintainer = (env, member) =>
  !!member?.github && member.github.toLowerCase() === String(env.PLATFORM_OWNER ?? "").toLowerCase();

/** One email through Resend: { to, subject, text, html }. Returns Resend's id or throws. */
export async function sendMail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("mail: not configured");
  const res = await fetch("https://api.resend.com/emails", {
    signal: AbortSignal.timeout(10000),
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, html }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`mail: Resend answered ${res.status}`);
  return out.id;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/**
 * A short, plain email in the platform's name: a few lines, one button, the link
 * written out too, and a text part. Names and summaries go in escaped.
 */
export function mailBody({ lines, button, url, footer }) {
  const text = [...lines, "", `${button}: ${url}`, "", footer].join("\n");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 16px;background:#ffffff;color:#2b2b2b;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:480px;margin:0 auto">
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join("\n")}
<p style="margin:20px 0"><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#52562f;color:#ffffff;text-decoration:none;font-weight:600">${esc(button)}</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#5f6368">Or open this link: <a href="${esc(url)}" style="color:#52562f;word-break:break-all">${esc(url)}</a></p>
<p style="margin:24px 0 0;font-size:14px;color:#5f6368">${esc(footer)}</p>
</div></body></html>`;
  return { text, html };
}

/**
 * Where links in emails point: this site in production. On a preview deployment,
 * that preview (so a test there links back to itself).
 */
export function linkOrigin(request) {
  const o = new URL(request.url).origin;
  return /^https:\/\/[a-z0-9-]+\.c4n-author-site\.pages\.dev$/.test(o) ? o : SITE;
}

// --- the request binding, exactly as the suggest-edit function computes it (lib/member.mjs) ---

export function canonicalQuery(params) {
  return [...params]
    .filter(([k]) => k !== "route")
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
export async function bindingOf({ method, endpoint, params, bodyText, book }) {
  return hash([method.toUpperCase(), `/api/${endpoint}`, canonicalQuery(params), await hash(bodyText), book].join("\n"));
}

/**
 * A new book (provisioned since batch 2b) arrives with its people as GitHub logins in
 * the registry's `authors`, and no members here yet. When one of those logins signs
 * in, each such book adopts its registry authors once: linked members are added,
 * missing ones are made (GitHub-linked, no email, "needs an email address"). A book
 * that already has members here is never touched: from then on the author site
 * decides, and the registry follows it.
 */
export async function adoptNewBooks(env, member) {
  if (!member?.github) return;
  let reg;
  try {
    reg = await registry();
  } catch {
    return;
  }
  const mine = reg.books.filter(
    (b) => b.status !== "retired" && (b.authors ?? []).some((a) => a.toLowerCase() === member.github.toLowerCase()),
  );
  for (const b of mine) {
    const has = await env.DB.prepare("SELECT 1 AS x FROM book_members WHERE book = ? LIMIT 1").bind(b.slug).first();
    if (has) continue;
    for (const login of b.authors ?? []) {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) continue;
      let m = await env.DB.prepare("SELECT id FROM members WHERE github = ?").bind(login).first();
      if (!m) {
        m = { id: memberId() };
        await env.DB.prepare("INSERT INTO members (id, display_name, github, created_at) VALUES (?, ?, ?, ?)").bind(m.id, login, login, now()).run();
      }
      await env.DB.prepare("INSERT OR IGNORE INTO book_members (book, member_id, added_at) VALUES (?, ?, ?)").bind(b.slug, m.id, now()).run();
    }
    await audit(env, b.slug, "The platform", "joined", `${(b.authors ?? []).length} people from the book's set-up`);
  }
}

/** Now and then, after answering: expired links, sessions, assertions and old rate windows go. */
export function prune(env, waitUntil) {
  if (Math.random() > 0.05) return;
  const t = now();
  waitUntil(
    env.DB.batch([
      env.DB.prepare("DELETE FROM links WHERE expires_at < ?").bind(t - DAY),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
      env.DB.prepare("DELETE FROM assertions WHERE expires_at < ?").bind(t - 3_600_000),
      env.DB.prepare("DELETE FROM rate WHERE expires_at < ?").bind(t),
    ]).catch(() => {}),
  );
}
