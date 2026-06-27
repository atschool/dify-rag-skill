#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_PATHS = [
  path.join(os.homedir(), ".dify-rag", "config"),
  path.join(process.cwd(), "config"),
];

function loadConfig() {
  const config = {};
  for (const filePath of DEFAULT_CONFIG_PATHS) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const index = line.indexOf("=");
      config[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    config._loadedFrom = filePath;
    break;
  }
  return config;
}

const config = loadConfig();

function configValue(key, fallback = "") {
  return process.env[key] || config[key] || fallback;
}

const host = configValue("DIFY_RAG_GATEWAY_HOST", "127.0.0.1");
const port = Number(configValue("DIFY_RAG_GATEWAY_PORT", "8787"));
const sharedSecret = configValue("DIFY_RAG_SHARED_SECRET", "");

function findScript(fileName) {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(__dirname, "..", fileName),
    path.join(os.homedir(), ".dify-rag", "mcp-server", fileName),
    path.join(os.homedir(), ".claude", "skills", "dify-rag-search", fileName),
    path.join(os.homedir(), ".claude", "skills", "dify-rag-inject", fileName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${fileName} was not found. Run ./install.sh on the gateway host.`);
}

function runPython(label, script, args) {
  const python = process.env.PYTHON || process.env.PYTHON_BIN || "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error([`${label} exited with code ${code}.`, stderr.trim(), stdout.trim()].filter(Boolean).join("\n")));
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function requireAuth(req) {
  if (!sharedSecret) return true;
  const auth = req.headers.authorization || "";
  const token = req.headers["x-dify-rag-token"] || "";
  return auth === `Bearer ${sharedSecret}` || token === sharedSecret;
}

function pushOptional(args, flag, value) {
  if (value === undefined || value === null || value === "") return;
  args.push(flag, String(value));
}

function formatSearchMarkdown(data) {
  const hits = Array.isArray(data.hits) ? data.hits : [];
  const datasets = Array.isArray(data.datasets_searched) ? data.datasets_searched : [];
  const lines = [
    "# Dify RAG Search Results",
    "",
    `Query: ${data.query || ""}`,
    `Datasets searched: ${datasets.length}`,
    "",
  ];

  if (!hits.length) {
    lines.push("No matching chunks found.");
    return lines.join("\n");
  }

  hits.forEach((hit, index) => {
    lines.push(`## Hit ${index + 1}`, "");
    lines.push(`- Document: ${hit.document_name || "(unknown document)"}`);
    lines.push(`- Dataset: ${hit.dataset_name || hit.dataset_id || "(unknown dataset)"}`);
    if (hit.score === null || hit.score === undefined) {
      lines.push("- Score: (not provided)");
    } else {
      lines.push(`- Score: ${Number(hit.score).toFixed(4)}`);
    }
    if (hit.segment_id) lines.push(`- Segment ID: ${hit.segment_id}`);
    lines.push("", hit.content || "(empty chunk)", "");
  });

  return lines.join("\n");
}

async function handleSearch(req, res) {
  const body = await readJson(req);
  if (!body.query || typeof body.query !== "string") {
    sendJson(res, 400, { ok: false, error: "query is required." });
    return;
  }

  const args = ["--query", body.query, "--format", "json"];
  pushOptional(args, "--top-k", body.top_k ?? 5);
  pushOptional(args, "--category", body.category);
  pushOptional(args, "--score-threshold", body.score_threshold);
  pushOptional(args, "--search-method", body.search_method);
  for (const datasetId of body.dataset_ids || []) {
    args.push("--dataset-id", String(datasetId));
  }

  const output = await runPython("dify_search.py", findScript("dify_search.py"), args);
  const data = JSON.parse(output || "{}");
  sendJson(res, 200, { ok: true, data, output: formatSearchMarkdown(data) });
}

async function handleDatasets(_req, res) {
  const output = await runPython("dify_search.py", findScript("dify_search.py"), ["--list-datasets"]);
  const datasets = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, ...nameParts] = line.split("\t");
      return { id, name: nameParts.join("\t") };
    });
  sendJson(res, 200, { ok: true, datasets, output: output || "No datasets found." });
}

async function handleInject(req, res) {
  const body = await readJson(req);
  if (!body.category || !body.doc_name || !body.markdown) {
    sendJson(res, 400, { ok: false, error: "category, doc_name, and markdown are required." });
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dify-rag-gateway-"));
  const tmpFile = path.join(tmpDir, "document.md");
  try {
    fs.writeFileSync(tmpFile, body.markdown, "utf8");
    const args = [
      "--category",
      body.category,
      "--doc-name",
      body.doc_name,
      "--file",
      tmpFile,
    ];
    pushOptional(args, "--user", body.user);
    if (body.dry_run) args.push("--dry-run");
    const output = await runPython("dify_inject.py", findScript("dify_inject.py"), args);
    sendJson(res, 200, { ok: true, output });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "dify-rag-gateway",
      config_loaded: Boolean(config._loadedFrom),
    });
    return;
  }

  if (!requireAuth(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/datasets") {
    await handleDatasets(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/search") {
    await handleSearch(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/inject") {
    await handleInject(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    sendJson(res, 500, { ok: false, error: error.message });
  });
});

server.listen(port, host, () => {
  console.error(`dify-rag-gateway listening on http://${host}:${port}`);
});
