// The pages emailed links open (batch 2b).
//   POST /api/invite { kind: "invite", token, action: "info" }   -> { title, name, inviter }
//   POST /api/invite { kind: "invite", token, action: "accept", name } -> joins, signs in
//   POST /api/invite { kind: "claim",  token, action: "info" }   -> { name, email }
//   POST /api/invite { kind: "claim",  token, action: "accept" } -> confirms the email, signs in
// An invitation is for one address and one book, single use, seven days: whoever
// opens it joins as that address. A claim confirms an address for a member who has
// none (filled in by another member, or given after a GitHub sign-in): only someone
// who can read that inbox can confirm it.
import { audit, body, bookEntry, cleanName, fail, json, memberId, now, sameSite, startSession } from "../_lib/core.js";
import { peekLink, useLink } from "../_lib/links.js";
import { requestSync } from "../_lib/sync.js";

const GONE = (what) => fail(410, "link used or expired", `This ${what} has been used or has expired. Ask whoever sent it for a new one.`);

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const b = await body(request);
  const kind = b.kind === "claim" ? "claim" : b.kind === "invite" ? "invite" : null;
  if (!kind || (b.action !== "info" && b.action !== "accept")) return fail(400, "bad request");

  if (b.action === "info") {
    const link = await peekLink(env, kind, b.token);
    if (!link) return GONE(kind === "invite" ? "invitation" : "link");
    if (kind === "claim") {
      const m = await env.DB.prepare("SELECT display_name FROM members WHERE id = ?").bind(link.member_id).first();
      return m ? json({ name: m.display_name, email: link.email }) : GONE("link");
    }
    const entry = await bookEntry(link.book).catch(() => null);
    const inviter = await env.DB.prepare("SELECT display_name FROM members WHERE id = ?").bind(link.created_by).first();
    return json({ title: entry?.title ?? link.book, name: link.name, inviter: inviter?.display_name ?? "Someone" });
  }

  const link = await useLink(env, kind, b.token);
  if (!link) return GONE(kind === "invite" ? "invitation" : "link");

  if (kind === "claim") {
    const taken = await env.DB.prepare("SELECT id FROM members WHERE email = ? AND id != ?").bind(link.email, link.member_id).first();
    if (taken) return fail(409, "email taken", "That address already belongs to someone on the platform.");
    const m = await env.DB.prepare("UPDATE members SET email = ? WHERE id = ? AND email IS NULL RETURNING id, display_name").bind(link.email, link.member_id).first();
    if (!m) return GONE("link");
    for (const book of (await env.DB.prepare("SELECT book FROM book_members WHERE member_id = ?").bind(m.id).all()).results.map((r) => r.book))
      await audit(env, book, m.display_name, "email-confirmed", m.display_name);
    return json({ ok: true }, 200, { "set-cookie": await startSession(env, m.id) });
  }

  if (!(await bookEntry(link.book).catch(() => null))) return GONE("invitation");
  const inviter = await env.DB.prepare("SELECT 1 AS x FROM book_members WHERE book = ? AND member_id = ?").bind(link.book, link.created_by).first();
  if (!inviter) return GONE("invitation"); // the inviter has left the book since
  const name = cleanName(b.name) || link.name;
  let member = await env.DB.prepare("SELECT id, display_name FROM members WHERE email = ?").bind(link.email).first();
  if (!member) {
    member = { id: memberId(), display_name: name };
    await env.DB.prepare("INSERT INTO members (id, display_name, email, created_at) VALUES (?, ?, ?, ?)").bind(member.id, name, link.email, now()).run();
  } else if (name !== member.display_name) {
    await env.DB.prepare("UPDATE members SET display_name = ? WHERE id = ?").bind(name, member.id).run();
    member.display_name = name;
  }
  await env.DB.prepare("INSERT OR IGNORE INTO book_members (book, member_id, added_by, added_at) VALUES (?, ?, ?, ?)").bind(link.book, member.id, link.created_by, now()).run();
  await audit(env, link.book, member.display_name, "joined", member.display_name);
  waitUntil(requestSync(env, link.book));
  return json({ ok: true, book: link.book }, 200, { "set-cookie": await startSession(env, member.id) });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
