// POST /api/internal/assertion { id, binding } — the suggest-edit function asks who
// a proxied request is from (fn/[[path]].js wrote the assertion a moment ago). It
// answers once: only for an unused, unexpired assertion whose binding (the hash of
// the method, endpoint, query, body and book the function itself received) matches
// the one the proxy wrote, and only while the member is still on that book. The same
// statement that checks it marks it used.
//   -> 200 { member: { id, name, github }, book, books } | 404
import { TOKEN_RE, booksOf, fail, hash, json, now, onBook } from "../../_lib/core.js";

export async function onRequestPost({ request, env }) {
  let b = {};
  try {
    b = await request.json();
  } catch {
    return fail(404, "unknown");
  }
  const id = typeof b?.id === "string" ? b.id : "";
  const binding = typeof b?.binding === "string" ? b.binding : "";
  if (!TOKEN_RE.test(id) || !/^[0-9a-f]{64}$/.test(binding)) return fail(404, "unknown");
  const row = await env.DB.prepare(
    "UPDATE assertions SET used_at = ? WHERE id_hash = ? AND binding_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING member_id, book",
  )
    .bind(now(), await hash(id), binding, now())
    .first();
  if (!row) return fail(404, "unknown");
  const m = await env.DB.prepare("SELECT id, display_name, github FROM members WHERE id = ?").bind(row.member_id).first();
  if (!m) return fail(404, "unknown");
  let books;
  if (row.book) {
    if (!(await onBook(env, m.id, row.book))) return fail(404, "unknown"); // removed since: refused at once
    books = [row.book];
  } else {
    books = await booksOf(env, m.id);
    if (!books.length) return fail(404, "unknown");
  }
  return json({ member: { id: m.id, name: m.display_name, github: m.github ?? null }, book: row.book, books });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
