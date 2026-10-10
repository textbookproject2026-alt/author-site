// GET /api/me — who is signed in: { member: { id, name, email, github, notify,
//   maintainer }, books: [slug], githubSignin } or { member: null, githubSignin }.
// POST /api/me { notify } — emails about reader suggestions on or off.
// POST /api/me { email } — a member moved over from GitHub gives an address: a link
//   goes there, and the address is theirs once they open it (api/invite.js, claim).
import { adoptNewBooks, allow, audit, body, booksOf, fail, isMaintainer, json, linkOrigin, mailBody, normEmail, prune, sameSite, sendMail, session, validEmail } from "../_lib/core.js";
import { createLink } from "../_lib/links.js";

export async function onRequestGet({ request, env, waitUntil }) {
  prune(env, waitUntil);
  const s = await session(request, env);
  const githubSignin = env.GITHUB_SIGNIN !== "off";
  if (!s) return json({ member: null, githubSignin });
  const m = s.member;
  await adoptNewBooks(env, m);
  return json({
    member: { id: m.id, name: m.display_name, email: m.email, github: m.github, notify: !!m.notify, maintainer: isMaintainer(env, m) },
    books: await booksOf(env, m.id),
    githubSignin,
  });
}

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const s = await session(request, env);
  if (!s) return fail(401, "signed out", "Please sign in again.");
  const b = await body(request);
  if (typeof b.notify === "boolean") {
    await env.DB.prepare("UPDATE members SET notify = ? WHERE id = ?").bind(b.notify ? 1 : 0, s.member.id).run();
    return json({ ok: true, notify: b.notify });
  }
  if ("email" in b) {
    if (s.member.email) return fail(409, "has email", "You already sign in with an email address.");
    const email = normEmail(b.email);
    if (!validEmail(email)) return fail(400, "bad email", "That doesn't look like an email address.");
    if (!(await allow(env, `claim:${s.member.id}`, 5, 3600))) return fail(429, "rate limited", "Too many tries. Wait a little.");
    const token = await createLink(env, { kind: "claim", memberId: s.member.id, email, createdBy: s.member.id });
    const mail = mailBody({
      lines: [`Hello ${s.member.display_name},`, "Open this link to sign in to the author site on Confused for Now with this email address from now on."],
      button: "Use this address",
      url: `${linkOrigin(request)}/#/claim/${token}`,
      footer: "If you didn't ask for this, you can ignore it.",
    });
    try {
      await sendMail(env, { to: email, subject: "Confirm your email for Confused for Now", ...mail });
    } catch (err) {
      console.error(`claim mail: ${err.message}`);
      return fail(502, "mail", "The email couldn't be sent just now. Try again in a moment.");
    }
    for (const book of await booksOf(env, s.member.id)) await audit(env, book, s.member, "email-requested", s.member.display_name);
    return json({ ok: true, sent: true });
  }
  return fail(400, "nothing to change");
}
