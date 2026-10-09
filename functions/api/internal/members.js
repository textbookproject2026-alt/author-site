// GET /api/internal/members?book=<slug> — a book's people as the public registry
// records them (the suggest-edit function's author-sync reads this): member ids and
// display names, the GitHub logins still linked, and who has reader-suggestion
// emails off. Never an email address.
import { bookEntry, fail, json } from "../../_lib/core.js";

export async function onRequestGet({ request, env }) {
  const book = new URL(request.url).searchParams.get("book") ?? "";
  if (!(await bookEntry(book).catch(() => null))) return fail(404, "not found");
  const { results } = await env.DB.prepare(
    "SELECT m.id, m.display_name, m.github, m.notify FROM book_members b JOIN members m ON m.id = b.member_id WHERE b.book = ? ORDER BY m.id",
  ).bind(book).all();
  return json({
    book,
    members: results.map((m) => ({ id: `m-${m.id}`, name: m.display_name })),
    github: results.filter((m) => m.github).map((m) => m.github).sort((a, b) => a.localeCompare(b)),
    mentionsOff: results.filter((m) => m.github && !m.notify).map((m) => m.github).sort((a, b) => a.localeCompare(b)),
  });
}
