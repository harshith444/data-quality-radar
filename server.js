import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCsv } from "./src/csv.js";
import { buildQualityReport } from "./src/radar.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const current = loadCsv(join(root, "data", "orders_current.csv"));
const baseline = loadCsv(join(root, "data", "orders_baseline.csv"));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3001);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/report") {
    return json(response, buildQualityReport(current, baseline));
  }

  if (url.pathname === "/api/rows") {
    return json(response, { rows: current.rows });
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const file = await readFile(join(root, "public", pathname));
    response.writeHead(200, { "content-type": mime[extname(pathname)] || "text/plain" });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(port, host, () => {
  console.log(`Data Quality Radar running at http://${host}:${port}`);
});

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
