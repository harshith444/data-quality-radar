import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCsv } from "./src/csv.js";
import { buildQualityReport } from "./src/radar.js";
import { applyCleaning, buildCleaningPlan, previewCleaning, profileData, analysisSuggestions } from "./src/cleaningAgent.js";
import { connectorStatuses } from "./src/connectors.js";
import { openAIProviderFromEnv } from "./src/llmProvider.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const current = loadCsv(join(root, "data", "orders_current.csv"));
const baseline = loadCsv(join(root, "data", "orders_baseline.csv"));
const messy = loadCsv(join(root, "data", "messy_customers.csv"));
const datasets = { orders: current, messy_customers: messy };
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

  if (request.method === "POST" && url.pathname === "/api/profile") {
    const body = await readJson(request);
    const dataset = resolveDataset(body.dataset);
    return json(response, profileData(dataset, body.useCase || ""));
  }

  if (request.method === "POST" && url.pathname === "/api/cleaning-plan") {
    const body = await readJson(request);
    const dataset = resolveDataset(body.dataset);
    const provider = body.provider === "openai" ? openAIProviderFromEnv() : null;
    return json(response, await buildCleaningPlan(dataset, { useCase: body.useCase, mode: body.mode || "balanced", provider }));
  }

  if (request.method === "POST" && url.pathname === "/api/cleaning-preview") {
    const body = await readJson(request);
    const dataset = resolveDataset(body.dataset);
    return json(response, previewCleaning(dataset, body.plan));
  }

  if (request.method === "POST" && url.pathname === "/api/apply-cleaning") {
    const body = await readJson(request);
    const dataset = resolveDataset(body.dataset);
    return json(response, applyCleaning(dataset, body.plan));
  }

  if (request.method === "POST" && url.pathname === "/api/analysis-suggestions") {
    const body = await readJson(request);
    const dataset = resolveDataset(body.dataset);
    const profile = profileData(dataset, body.useCase || "");
    return json(response, { suggestions: analysisSuggestions(profile, body.useCase || "") });
  }

  if (url.pathname === "/api/connectors") {
    return json(response, { connectors: connectorStatuses() });
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

function resolveDataset(dataset) {
  if (dataset?.headers && dataset?.rows) return dataset;
  if (typeof dataset === "string" && datasets[dataset]) return datasets[dataset];
  return datasets.orders;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
