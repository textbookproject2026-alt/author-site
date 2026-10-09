// POST /api/auth/consume { token } — the sign-in link's page posts its token here.
// Single use, 15 minutes; then a 30-day session cookie. Only for a member still on
// a book.
import { body, booksOf, fail, json, sameSite, startSession } from "../../_lib/core.js";
import { useLink } from "../../_lib/links.js";

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const link = await useLink(env, "signin", (await body(request)).token);
  if (!link) return fail(410, "link used or expired", "That link has been used or has expired. Ask for a new one below.");
  const member = await env.DB.prepare("SELECT id, display_name, email FROM members WHERE id = ?").bind(link.member_id).first();
  // The address the link went to must still be theirs, and they must still be on a book.
  if (!member || member.email !== link.email || !(await booksOf(env, member.id)).length)
    return fail(410, "link used or expired", "That link has been used or has expired. Ask for a new one below.");
  return json({ ok: true, name: member.display_name }, 200, { "set-cookie": await startSession(env, member.id) });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
