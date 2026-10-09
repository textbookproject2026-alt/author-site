// The registry stays the public record of who is on each book (display names and
// member ids, never emails). After a change here, the suggest-edit function is asked
// to bring the registry in line: its author-sync reads /api/internal/members and
// opens or updates one pull request, which merges itself on green. A failed or slow
// sync never affects access, which follows this database.
import { UPSTREAM, registry } from "./core.js";

export async function requestSync(env, book) {
  try {
    const res = await fetch(`${UPSTREAM}/api/author-sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ book }),
      redirect: "manual",
    });
    if (!res.ok) console.error(`sync ${book}: HTTP ${res.status}`);
  } catch (err) {
    console.error(`sync ${book}: ${err.message}`);
  }
}

/** For the platform maintainer: does the registry list the same people as here? */
export async function syncStatus(env, book) {
  const { results } = await env.DB.prepare("SELECT member_id FROM book_members WHERE book = ?").bind(book).all();
  const here = results.map((m) => `m-${m.member_id}`).sort();
  let listed = null;
  try {
    const entry = (await registry()).books.find((b) => b.slug === book);
    listed = (entry?.members ?? []).map((m) => m.id).sort();
  } catch {
    /* the registry couldn't be read just now */
  }
  return { inSync: listed !== null && JSON.stringify(listed) === JSON.stringify(here), here: here.length, registry: listed?.length ?? null };
}
