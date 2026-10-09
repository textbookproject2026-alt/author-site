// POST /api/auth/signout { everywhere } — this browser, or every browser the member
// is signed in on.
import { body, fail, json, sameSite, session, sessionCookie } from "../../_lib/core.js";

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const s = await session(request, env);
  if (s) {
    if ((await body(request)).everywhere === true) await env.DB.prepare("DELETE FROM sessions WHERE member_id = ?").bind(s.member.id).run();
    else await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(s.sessionHash).run();
  }
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", allow: "POST" } });
