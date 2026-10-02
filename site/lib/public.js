// Reads that need no sign-in, made from the browser (never from the function: GitHub
// limits unauthenticated reads per address, and that should be the author's, not
// the function's shared one). Everything here is public: the registry, the books'
// repositories and their drafts previews.

const REGISTRY = "https://raw.githubusercontent.com/textbookproject2026-alt/textbook-registry/main/registry.json";
const STALE_AFTER_MS = 10 * 60 * 1000;

let registry = null;
/** The registry's entry for a book, or null (the page still works without it). */
export async function registryBook(slug) {
  try {
    registry ??= fetch(REGISTRY, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
    return (await registry)?.books?.find((b) => b.slug === slug) ?? null;
  } catch {
    registry = null;
    return null;
  }
}

/** Every comment in the margins of the book's site (Hypothes.is), as the app linked it. */
export const discussionUrl = (b) => (b?.site?.domain ? `https://hypothes.is/search?q=url:https://${b.site.domain}/*` : null);

// quartz-book's branchAlias (builder/lib.mjs), exactly: the name Cloudflare gives a
// branch's preview.
const branchAlias = (branch) => branch.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 28);

/** Where the builder serves the drafts branch, or null for a book without one. */
export function draftsPreview(b) {
  const host = b?.site?.host;
  if (!host?.builder || !/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(host.project ?? "")) return null;
  return `https://${branchAlias(b.content.drafts_branch)}.${host.project}.pages.dev/`;
}

/**
 * Whether the drafts preview shows the drafts as they stand (the app's preview.py):
 * "current", "building" (under ten minutes behind), "stale", or "unknown".
 * `head` is the drafts commit and `headWhen` its time, from the author endpoints.
 */
export async function previewState(b, head, headWhen) {
  const url = draftsPreview(b);
  if (!url) return null;
  let marker = null;
  try {
    const res = await fetch(`${url}.well-known/textbook.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) marker = await res.json();
    else if (res.status !== 404) return { url, state: "unknown" };
  } catch {
    return { url, state: "unknown" };
  }
  const built = marker && marker.slug === b.slug && marker.branch === b.content.drafts_branch ? marker.book_commit : null;
  if (built && built === head) return { url, state: "current", hasBuild: true };
  const since = Date.parse(headWhen ?? "");
  const stale = !Number.isNaN(since) && Date.now() - since >= STALE_AFTER_MS;
  return { url, state: stale ? "stale" : "building", hasBuild: Boolean(built) };
}

export const PREVIEW_WORDS = {
  current: "The preview shows the drafts area as it stands.",
  building: "The preview is being rebuilt with the latest change to the drafts area. That usually takes two or three minutes.",
  stale: "The preview is still at an earlier version: the latest change hasn't reached it after ten minutes. The change is safe in the drafts area. If this lasts, tell the technical contact.",
  stale_none: "There is no preview of the drafts area yet, ten minutes after the latest change. The change is safe in the drafts area. If this lasts, tell the technical contact.",
  unknown: "Whether the preview is up to date couldn't be checked just now.",
};

/**
 * The book's automatic jobs, each with how its last finished run went:
 * [{ name, state: "ok" | "failed" | "none", when, url }], or null if GitHub can't be asked.
 */
export async function jobs(b) {
  const api = `https://api.github.com/repos/${b.content.repo}/actions`;
  try {
    const list = await fetch(`${api}/workflows?per_page=50`).then((r) => (r.ok ? r.json() : Promise.reject()));
    const active = (list.workflows ?? []).filter((w) => w.state === "active");
    return await Promise.all(active.map(async (w) => {
      const runs = await fetch(`${api}/workflows/${w.id}/runs?per_page=1&status=completed`).then((r) => (r.ok ? r.json() : { workflow_runs: [] }));
      const run = runs.workflow_runs?.[0];
      return run
        ? { name: w.name, state: run.conclusion === "success" ? "ok" : "failed", when: run.updated_at, url: run.html_url }
        : { name: w.name, state: "none", when: null, url: w.html_url };
    }));
  } catch {
    return null;
  }
}
