// "Where you're signed in" (batch 2c): the member's own sessions, and signing one out.
//   GET  /api/sessions                      -> { sessions: [{ id, device, created, lastActive, current }] }
//   POST /api/sessions { id }               -> signs that session out at once (yours only)
// `id` is the session's public handle, never its token or the token's hash.
import { body, fail, json, now, sameSite, session, sessionCookie } from "../_lib/core.js";

const SID_RE = /^[0-9a-f]{16}$/;

export async function onRequestGet({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const s = await session(request, env);
  if (!s) return fail(401, "signed out", "Please sign in again.");
  const { results } = await env.DB.prepare(
    "SELECT sid, label, created_at, last_active FROM sessions WHERE member_id = ? AND expires_at > ? ORDER BY last_active DESC",
  )
    .bind(s.member.id, now())
    .all();
  return json({
    sessions: results.map((r) => ({ id: r.sid, device: r.label ?? "A browser", created: r.created_at, lastActive: r.last_active ?? r.created_at, current: r.sid === s.sid })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const s = await session(request, env);
  if (!s) return fail(401, "signed out", "Please sign in again.");
  const id = String((await body(request)).id ?? "");
  if (!SID_RE.test(id)) return fail(400, "bad request");
  const gone = await env.DB.prepare("DELETE FROM sessions WHERE sid = ? AND member_id = ?").bind(id, s.member.id).run();
  if (!gone.meta.changes) return fail(404, "not found", "That browser is already signed out.");
  return json({ ok: true, current: id === s.sid }, 200, id === s.sid ? { "set-cookie": sessionCookie("", 0) } : {});
}

/** Anything else. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", allow: "GET, POST" } });
