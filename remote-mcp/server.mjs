#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

const CONFIG_PATHS = [
  path.join(os.homedir(), ".dify-rag", "config"),
  path.join(process.cwd(), "config"),
];

const WRITE_DENIED_MESSAGE =
  "This connector account is not allowed to add or update knowledge. Ask a maintainer to add the material.";

function loadConfig() {
  const config = {};
  for (const filePath of CONFIG_PATHS) {
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

const host = configValue("DIFY_RAG_REMOTE_MCP_HOST", "127.0.0.1");
const port = Number(configValue("DIFY_RAG_REMOTE_MCP_PORT", "8788"));
const mcpPath = configValue("DIFY_RAG_REMOTE_MCP_PATH", "/mcp");
const gatewayBase = configValue(
  "DIFY_RAG_REMOTE_GATEWAY_URL",
  configValue("DIFY_RAG_GATEWAY_URL", "http://127.0.0.1:8787")
).replace(/\/+$/, "");
const gatewaySecret = configValue("DIFY_RAG_SHARED_SECRET", "");

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function allowedAddEmails() {
  return new Set(
    splitCsv(
      configValue(
        "DIFY_RAG_ADD_ALLOWED_EMAILS",
        configValue("DIFY_RAG_INGEST_ALLOWED_EMAILS", "")
      )
    )
  );
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers[name];
    if (Array.isArray(value) && value.length) return String(value[0]).trim();
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function identityFromRequest(req) {
  const headerEmail = firstHeader(req.headers, [
    "cf-access-authenticated-user-email",
    "x-authenticated-user-email",
    "x-forwarded-email",
  ]);
  if (headerEmail) return { email: headerEmail.toLowerCase(), source: "header" };

  const accessJwt = firstHeader(req.headers, ["cf-access-jwt-assertion"]);
  const accessPayload = decodeJwtPayload(accessJwt);
  if (accessPayload.email) {
    return { email: String(accessPayload.email).toLowerCase(), source: "cf-access-jwt" };
  }

  const auth = firstHeader(req.headers, ["authorization"]);
  if (auth.toLowerCase().startsWith("bearer ")) {
    const payload = decodeJwtPayload(auth.slice("bearer ".length).trim());
    if (payload.email) {
      return { email: String(payload.email).toLowerCase(), source: "bearer-jwt" };
    }
  }

  return { email: "", source: "anonymous" };
}

function canAddKnowledge(identity) {
  const allowed = allowedAddEmails();
  if (!allowed.size) return false;
  return Boolean(identity.email && allowed.has(identity.email.toLowerCase()));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve(undefined);
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function requestGateway(method, pathname, payload) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (gatewaySecret) {
    headers.Authorization = `Bearer ${gatewaySecret}`;
  }

  const response = await fetch(`${gatewayBase}${pathname}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Gateway returned non-JSON response (${response.status}):\n${text}`);
  }

  if (!response.ok || data.ok === false) {
    throw new Error(`Gateway request failed (${response.status}): ${data.error || text}`);
  }

  return data;
}

function createMcpServer(identity) {
  const server = new McpServer({
    name: "dify-rag-knowledge",
    version: "0.1.0",
  });

  server.registerTool(
    "search_knowledge",
    {
      title: "Search Knowledge",
      description: "Search the configured Dify knowledge base for relevant source chunks.",
      inputSchema: {
        query: z.string().min(1).describe("Question or keywords to search for"),
        top_k: z.number().int().min(1).max(20).optional().describe("Number of results to return"),
        category: z.string().optional().describe("Optional category name or dataset name filter"),
        dataset_ids: z.array(z.string().min(1)).optional().describe("Optional Dify dataset ID filter"),
        score_threshold: z.number().min(0).max(1).optional().describe("Optional minimum score"),
      },
    },
    async ({ query, top_k, category, dataset_ids, score_threshold }) => {
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
            text: response.output || "No matching results were found.",
          },
        ],
      };
    }
  );

  server.registerTool(
    "add_knowledge",
    {
      title: "Add Knowledge",
      description: "Add or update prepared Markdown in the configured Dify knowledge base. Maintainer access is required.",
      inputSchema: {
        category: z.string().min(1).describe("Destination category or routing key"),
        doc_name: z.string().min(1).describe("Document name"),
        markdown: z.string().min(1).describe("Prepared Markdown body for retrieval"),
        dry_run: z.boolean().optional().describe("Preview without sending to Dify"),
      },
    },
    async ({ category, doc_name, markdown, dry_run }) => {
      if (!canAddKnowledge(identity)) {
        return {
          content: [
            {
              type: "text",
              text: WRITE_DENIED_MESSAGE,
            },
          ],
          isError: true,
        };
      }

      const response = await requestGateway("POST", "/inject", {
        category,
        doc_name,
        markdown,
        user: identity.email || "remote-mcp",
        dry_run,
      });

      return {
        content: [
          {
            type: "text",
            text: response.output || "Knowledge was added or updated.",
          },
        ],
      };
    }
  );

  return server;
}

const transports = {};

async function handleMcp(req, res, parsedBody) {
  const identity = identityFromRequest(req);
  const sessionId = firstHeader(req.headers, ["mcp-session-id"]);
  let transport = sessionId ? transports[sessionId] : undefined;
  let mcpServer;
  let ephemeral = false;

  if (!transport && req.method === "POST" && isInitializeRequest(parsedBody)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports[newSessionId] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    mcpServer = createMcpServer(identity);
    await mcpServer.connect(transport);
  } else if (!transport && req.method === "POST") {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    mcpServer = createMcpServer(identity);
    await mcpServer.connect(transport);
    ephemeral = true;
  } else if (!transport) {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid MCP session.",
      },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    if (ephemeral) {
      await transport.close();
      await mcpServer.close();
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "dify-rag-remote-mcp",
        config_loaded: Boolean(config._loadedFrom),
        gateway_url: gatewayBase,
        add_allowlist_configured: allowedAddEmails().size > 0,
      });
      return;
    }

    if (url.pathname !== mcpPath) {
      sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const parsedBody = undefined;
      await handleMcp(req, res, parsedBody);
      return;
    }

    if (req.method === "POST") {
      const parsedBody = await readJson(req);
      await handleMcp(req, res, parsedBody);
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "content-type,mcp-session-id,mcp-protocol-version,authorization",
      });
      res.end();
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error.message,
        },
        id: null,
      });
    }
  }
});

server.listen(port, host, () => {
  console.error(`dify-rag-remote-mcp listening on http://${host}:${port}${mcpPath}`);
});
