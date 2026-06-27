#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = new McpServer({
  name: "dify-rag",
  version: "0.1.0",
});

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

const DEFAULT_CONFIG_PATHS = [
  path.join(os.homedir(), ".dify-rag", "config"),
  path.join(os.homedir(), ".claude", "skills", "dify-rag-search", "config"),
  path.join(os.homedir(), ".claude", "skills", "dify-rag-inject", "config"),
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

function gatewayUrl() {
  return configValue("DIFY_RAG_GATEWAY_URL").replace(/\/+$/, "");
}

function cloudflareAccessMode() {
  return configValue("DIFY_RAG_CLOUDFLARE_ACCESS", "auto").toLowerCase();
}

function cloudflareAccessEnabled() {
  return !["0", "false", "no", "off", "none", "disabled"].includes(cloudflareAccessMode());
}

function decodeJwtExpiry(token) {
  const parts = token.split(".");
  if (parts.length < 2) return 0;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Number(payload.exp || 0);
  } catch {
    return 0;
  }
}

let cachedCloudflareAccessToken = {
  appUrl: "",
  token: "",
  expiresAt: 0,
};

function getCloudflareAccessToken(appUrl) {
  const now = Math.floor(Date.now() / 1000);
  if (
    cachedCloudflareAccessToken.appUrl === appUrl &&
    cachedCloudflareAccessToken.token &&
    cachedCloudflareAccessToken.expiresAt > now + 60
  ) {
    return cachedCloudflareAccessToken.token;
  }

  const cloudflared = configValue("DIFY_RAG_CLOUDFLARED_BIN", "cloudflared");
  const result = spawnSync(cloudflared, ["access", "token", `-app=${appUrl}`], {
    encoding: "utf8",
    timeout: 120000,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        [
          "Cloudflare Access protects the configured gateway, but cloudflared was not found.",
          "Install it with `brew install cloudflared`, then run:",
          `cloudflared access login ${appUrl}`,
        ].join("\n")
      );
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      [
        "Could not get a Cloudflare Access token for the configured gateway.",
        `Run this once, then retry Claude.app: cloudflared access login ${appUrl}`,
        detail,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const token = result.stdout.trim();
  if (!token) {
    throw new Error(`cloudflared returned an empty Access token. Run: cloudflared access login ${appUrl}`);
  }

  cachedCloudflareAccessToken = {
    appUrl,
    token,
    expiresAt: decodeJwtExpiry(token),
  };
  return token;
}

function buildGatewayHeaders(base, includeCloudflareAccessToken) {
  const headers = {
    "Content-Type": "application/json",
  };
  const sharedSecret = configValue("DIFY_RAG_SHARED_SECRET");
  if (sharedSecret) {
    headers.Authorization = `Bearer ${sharedSecret}`;
  }
  if (includeCloudflareAccessToken && cloudflareAccessEnabled()) {
    headers["cf-access-token"] = getCloudflareAccessToken(base);
  }
  return headers;
}

async function fetchGateway(base, method, pathname, payload, includeCloudflareAccessToken) {
  return fetch(`${base}${pathname}`, {
    method,
    headers: buildGatewayHeaders(base, includeCloudflareAccessToken),
    redirect: "manual",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function requestGateway(method, pathname, payload) {
  const base = gatewayUrl();
  if (!base) {
    throw new Error("DIFY_RAG_GATEWAY_URL is not set.");
  }

  let response = await fetchGateway(base, method, pathname, payload, cloudflareAccessMode() === "on");
  const redirectLocation = response.headers.get("location") || "";
  if (
    response.status >= 300 &&
    response.status < 400 &&
    redirectLocation.includes("cloudflareaccess.com") &&
    cloudflareAccessEnabled()
  ) {
    response = await fetchGateway(base, method, pathname, payload, true);
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (response.status >= 300 && response.status < 400 && redirectLocation.includes("cloudflareaccess.com")) {
      throw new Error(
        [
          `Gateway is protected by Cloudflare Access (${response.status}).`,
          `Run this once, then retry Claude.app: cloudflared access login ${base}`,
        ].join("\n")
      );
    }
    throw new Error(`Gateway returned non-JSON response (${response.status}):\n${text}`);
  }

  if (!response.ok || data.ok === false) {
    throw new Error(`Gateway request failed (${response.status}): ${data.error || text}`);
  }
  return data;
}

function findSearchScript() {
  const candidates = [
    process.env.DIFY_RAG_SEARCH_SCRIPT,
    path.join(__dirname, "dify_search.py"),
    path.join(__dirname, "..", "dify_search.py"),
    path.join(os.homedir(), ".claude", "skills", "dify-rag-search", "dify_search.py"),
  ]
    .filter(Boolean)
    .map(expandHome);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "dify_search.py was not found. Run ./install.sh again or set DIFY_RAG_SEARCH_SCRIPT."
  );
}

function findInjectScript() {
  const candidates = [
    process.env.DIFY_RAG_INJECT_SCRIPT,
    path.join(__dirname, "dify_inject.py"),
    path.join(__dirname, "..", "dify_inject.py"),
    path.join(os.homedir(), ".claude", "skills", "dify-rag-inject", "dify_inject.py"),
  ]
    .filter(Boolean)
    .map(expandHome);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "dify_inject.py was not found. Run ./install.sh again or set DIFY_RAG_INJECT_SCRIPT."
  );
}

function runPythonScript(label, script, args) {
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
      const message = [
        `${label} exited with code ${code}.`,
        stderr.trim(),
        stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(message));
    });
  });
}

function runSearchScript(args) {
  return runPythonScript("dify_search.py", findSearchScript(), args);
}

function runInjectScript(args) {
  return runPythonScript("dify_inject.py", findInjectScript(), args);
}

function pushOptional(args, flag, value) {
  if (value === undefined || value === null || value === "") return;
  args.push(flag, String(value));
}

server.registerTool(
  "search_dify_knowledge",
  {
    title: "Search Dify Knowledge",
    description:
      "Search Dify knowledge bases and return source chunks. Use this instead of Google Drive when the user asks to search Dify or the RAG knowledge base.",
    inputSchema: {
      query: z.string().min(1).describe("Search query"),
      top_k: z.number().int().min(1).max(20).optional().describe("Number of merged hits to return"),
      category: z
        .string()
        .optional()
        .describe("Optional dataset name fragment or exact dataset ID filter"),
      dataset_ids: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional explicit dataset IDs to search"),
      score_threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Optional minimum retrieval score"),
    },
  },
  async ({ query, top_k, category, dataset_ids, score_threshold }) => {
    if (gatewayUrl()) {
      const response = await requestGateway("POST", "/search", {
        query,
        top_k: top_k ?? 5,
        category,
        dataset_ids,
        score_threshold,
      });
      return {
        content: [
          {
            type: "text",
            text: response.output || "No output returned from Dify gateway search.",
          },
        ],
      };
    }

    const args = ["--query", query, "--format", "markdown"];
    pushOptional(args, "--top-k", top_k ?? 5);
    pushOptional(args, "--category", category);
    pushOptional(args, "--score-threshold", score_threshold);
    for (const datasetId of dataset_ids ?? []) {
      args.push("--dataset-id", datasetId);
    }

    const output = await runSearchScript(args);
    return {
      content: [
        {
          type: "text",
          text: output || "No output returned from Dify search.",
        },
      ],
    };
  }
);

server.registerTool(
  "inject_dify_knowledge",
  {
    title: "Inject Dify Knowledge",
    description:
      "Add or update a prepared Markdown document in Dify through the configured ingestion Workflow. Use only when the user explicitly asks to add material to Dify or the RAG knowledge base.",
    inputSchema: {
      category: z
        .string()
        .min(1)
        .describe("Knowledge category or dataset routing name"),
      doc_name: z.string().min(1).describe("Document name to create or update"),
      markdown: z
        .string()
        .min(1)
        .describe("Retrieval-ready Markdown content extracted from the source material"),
      user: z
        .string()
        .min(1)
        .optional()
        .describe("Optional Dify workflow user identifier"),
      dry_run: z
        .boolean()
        .optional()
        .describe("Preview the ingestion request without sending it to Dify"),
    },
  },
  async ({ category, doc_name, markdown, user, dry_run }) => {
    if (gatewayUrl()) {
      const response = await requestGateway("POST", "/inject", {
        category,
        doc_name,
        markdown,
        user,
        dry_run,
      });
      return {
        content: [
          {
            type: "text",
            text: response.output || "No output returned from Dify gateway ingestion.",
          },
        ],
      };
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dify-rag-inject-"));
    const tmpFile = path.join(tmpDir, "document.md");

    try {
      fs.writeFileSync(tmpFile, markdown, "utf8");
      const args = [
        "--category",
        category,
        "--doc-name",
        doc_name,
        "--file",
        tmpFile,
      ];
      pushOptional(args, "--user", user);
      if (dry_run) {
        args.push("--dry-run");
      }

      const output = await runInjectScript(args);
      return {
        content: [
          {
            type: "text",
            text: output || "No output returned from Dify ingestion.",
          },
        ],
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);

server.registerTool(
  "list_dify_datasets",
  {
    title: "List Dify Datasets",
    description:
      "List Dify datasets visible to the configured Knowledge Base API key.",
    inputSchema: {},
  },
  async () => {
    if (gatewayUrl()) {
      const response = await requestGateway("GET", "/datasets");
      return {
        content: [
          {
            type: "text",
            text: response.output || "No datasets found.",
          },
        ],
      };
    }

    const output = await runSearchScript(["--list-datasets"]);
    return {
      content: [
        {
          type: "text",
          text: output || "No datasets found.",
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dify-rag MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
