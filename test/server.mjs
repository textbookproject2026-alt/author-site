// site/ served as Cloudflare Pages serves it: the files, with site/_headers' "/*"
// headers (the CSP above all) on every response.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

export const SITE = new URL("../site/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".py": "text/plain; charset=utf-8" };

export function pagesHeaders() {
  const text = readFileSync(join(SITE, "_headers"), "utf8");
  const block = text.split(/\n(?=\S)/).find((b) => b.startsWith("/*\n"));
  return Object.fromEntries(block.split("\n").slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
}

/** Resolves to { origin, close }. */
export async function startServer() {
  const headers = pagesHeaders();
  const server = createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "");
    if (!path || path.endsWith("/")) path += "index.html";
    const file = join(SITE, path);
    if (!file.startsWith(SITE) || !existsSync(file) || !statSync(file).isFile() || path === "_headers") {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...headers });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
