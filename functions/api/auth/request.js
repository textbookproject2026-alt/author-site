// POST /api/auth/request { email } — "Email me a sign-in link". The answer is the
// same whether or not the address belongs to a member (and arrives after the same
// work either way), so the form tells nobody who is registered. A member gets a
// single-use link, good for 15 minutes. Rate-limited per address and per IP.
import { allow, body, fail, hash, json, linkOrigin, mailBody, normEmail, sameSite, sendMail, validEmail } from "../../_lib/core.js";
import { createLink } from "../../_lib/links.js";

export const SAME_ANSWER = { ok: true, userMessage: "If that address has access, we've sent a link. It works once, for 15 minutes." };

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const email = normEmail((await body(request)).email);
  if (!validEmail(email)) return fail(400, "bad email", "That doesn't look like an email address.");
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await allow(env, `signin:ip:${ip}`, 20, 3600))) return fail(429, "rate limited", "Too many sign-in links asked for. Wait a little, then try again.");
  // Everything about the address happens after the answer, so a member's address and a
  // stranger's are answered alike and as fast. At most five links an hour to an
  // address, counted only when one is sent (asking for a stranger's costs nobody).
  const origin = linkOrigin(request);
  waitUntil(
    (async () => {
      const member = await env.DB.prepare(
        "SELECT m.id, m.display_name FROM members m WHERE m.email = ? AND EXISTS (SELECT 1 FROM book_members b WHERE b.member_id = m.id)",
      )
        .bind(email)
        .first();
      if (!member || !(await allow(env, `signin:email:${await hash(email)}`, 5, 3600))) return;
      const token = await createLink(env, { kind: "signin", memberId: member.id, email });
      const mail = mailBody({
        lines: [`Hello ${member.display_name},`, "Here is your link to sign in to the author site on Confused for Now. It works once, for the next 15 minutes."],
        button: "Sign in",
        url: `${origin}/#/link/${token}`,
        footer: "If you didn't ask for this, you can ignore it: nobody can sign in without the link.",
      });
      await sendMail(env, { to: email, subject: "Your sign-in link for Confused for Now", ...mail });
    })().catch((err) => console.error(`signin: ${err.message}`)),
  );
  return json(SAME_ANSWER);
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
