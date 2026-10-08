import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/debate.js";
const root = fileURLToPath(new URL("../public", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
http
  .createServer(async (req, res) => {
    if (req.url.startsWith("/api/debate")) return handler(req, res);
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + path.sep)) throw new Error();
      res.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end("No encontrado");
    }
  })
  .listen(Number(process.env.PORT) || 3000, () =>
    console.log(
      "Debate UNAMAD: http://localhost:" + (process.env.PORT || 3000),
    ),
  );
