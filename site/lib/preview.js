// A chapter as readers will roughly see it. As in the books' in-site editor
// (edit-on-github editor.ts, forPreview and sanitise, copied): Obsidian syntax
// reduced to what a reader sees, rendered by GitHub's markdown API, and sanitised a
// second time here. Pictures are then pointed at where they really are: `pictureUrl`
// maps a path in the book to a URL (the drafts on GitHub, or an import's staged copy).

import { h } from "./dom.js";

/** Obsidian syntax GitHub doesn't know, reduced to what a reader would see. */
export const forPreview = (md) =>
  md
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, (_m, t) => t.split("/").pop())
    .replace(/\s\^[A-Za-z0-9-]+\s*$/gm, "")
    .replace(/%%[\s\S]*?%%/g, "");

const DROP = "script, style, iframe, object, embed, form, input, button, link, meta, base, frame, frameset";

/** GitHub's renderer already sanitises; this is the second lock. */
export const sanitise = (html) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DROP).forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => {
    for (const a of Array.from(n.attributes)) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith("on") || ((a.name === "href" || a.name === "src") && /^(javascript|data|vbscript):/.test(v)))
        n.removeAttribute(a.name);
    }
    if (n.tagName === "A") {
      n.setAttribute("target", "_blank");
      n.setAttribute("rel", "noopener noreferrer");
    }
  });
  const frag = document.createDocumentFragment();
  frag.append(...Array.from(doc.body.childNodes));
  return frag;
};

/** A path in the book for a link in the chapter at `chapterPath`, or null if it leads elsewhere. */
export function bookPath(chapterPath, src) {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#")) return null;
  let path;
  try {
    path = decodeURIComponent(src.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const parts = path.startsWith("/") ? [] : chapterPath.split("/").slice(0, -1);
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Renders `markdown` (a chapter at `chapterPath`) into a new preview element.
 * `pictureUrl(path)` resolves to a URL for a picture in the book, or null.
 */
export async function renderChapter(markdown, chapterPath, pictureUrl) {
  const box = h("div", { class: "preview", role: "document", "aria-label": "Preview" });
  let html;
  try {
    const res = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: { Accept: "text/html", "Content-Type": "application/json" },
      body: JSON.stringify({ text: forPreview(markdown), mode: "markdown" }),
    });
    if (!res.ok) throw new Error(String(res.status));
    html = await res.text();
  } catch {
    // GitHub's renderer unavailable (or its hourly limit reached): the text itself.
    box.append(h("p", { class: "muted small", text: "The formatted preview isn't available just now, so this is the chapter's text as it is written." }),
      h("pre", { class: "wrap", text: markdown }));
    return box;
  }
  box.append(sanitise(html));
  await Promise.all([...box.querySelectorAll("img")].map(async (img) => {
    const path = bookPath(chapterPath, img.getAttribute("src"));
    const url = path ? await pictureUrl(path) : null;
    if (url) img.src = url;
    else img.removeAttribute("src");
    img.loading = "lazy";
  }));
  return box;
}
