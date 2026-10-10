// POST /api/auth/revoke { token, action } — the new-browser alert's "This wasn't me"
// (batch 2c). Opening the emailed link shows a page; nothing happens until its
// button is pressed (a mail scanner that opens the link changes nothing):
//   action "info"    -> { device, when } of the sign-in the alert was about; the link stays unused
//   action "confirm" -> uses the link: every session of the member ends, their
//                       pending requests go, and the browser it was about is forgotten
//                       (a sign-in from it alerts again). Signs nobody in.
import { body, fail, json, sameSite, sessionCookie } from "../../_lib/core.js";
import { peekLink, useLink } from "../../_lib/links.js";

const GONE = () => fail(410, "link used or expired", "This link has been used or has expired. If you're worried, sign in and use “Sign out everywhere” in the account menu.");

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const b = await body(request);
  if (b.action === "info") {
    const link = await peekLink(env, "revoke", b.token);
    if (!link) return GONE();
    const d = await env.DB.prepare("SELECT label, first_seen FROM devices WHERE member_id = ? AND device_hash = ?").bind(link.member_id, link.device_hash).first();
    return json({ device: d?.label ?? "A browser", when: d?.first_seen ?? link.created_at });
  }
  if (b.action !== "confirm") return fail(400, "bad request");
  const link = await useLink(env, "revoke", b.token);
  if (!link) return GONE();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE member_id = ?").bind(link.member_id),
    env.DB.prepare("DELETE FROM assertions WHERE member_id = ?").bind(link.member_id),
    env.DB.prepare("DELETE FROM devices WHERE member_id = ? AND device_hash = ?").bind(link.member_id, link.device_hash),
    env.DB.prepare("DELETE FROM links WHERE member_id = ? AND kind = 'signin' AND used_at IS NULL").bind(link.member_id),
  ]);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", "x-content-type-options": "nosniff", allow: "POST" } });
