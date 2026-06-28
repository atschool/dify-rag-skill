#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
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
const mcpPath = normalizeRoutePath(configValue("DIFY_RAG_REMOTE_MCP_PATH", "/rag"));
const gatewayBase = configValue(
  "DIFY_RAG_REMOTE_GATEWAY_URL",
  configValue("DIFY_RAG_GATEWAY_URL", "http://127.0.0.1:8787")
).replace(/\/+$/, "");
const gatewaySecret = configValue("DIFY_RAG_SHARED_SECRET", "");
const authProvider = configValue("DIFY_RAG_AUTH_PROVIDER", "none").trim().toLowerCase();
const oauthScopes = configValue("DIFY_RAG_OAUTH_SCOPES", "openid email profile").trim();
const oauthAuthorizationServer = configValue(
  "DIFY_RAG_OAUTH_AUTHORIZATION_SERVER",
  authProvider === "google" ? "https://accounts.google.com" : ""
).replace(/\/+$/, "");
const publicMcpUrl = configValue("DIFY_RAG_REMOTE_PUBLIC_URL", "").replace(/\/+$/, "");
const tokenIdentityCache = new Map();

function normalizeRoutePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "/";
  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function authEnabled() {
  return Boolean(authProvider && authProvider !== "none");
}

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

function allowedAuthEmails() {
  return new Set(
    splitCsv(
      configValue(
        "DIFY_RAG_AUTH_ALLOWED_EMAILS",
        configValue("DIFY_RAG_ALLOWED_EMAILS", "")
      )
    )
  );
}

function allowedAuthDomains() {
  return new Set(
    splitCsv(
      configValue(
        "DIFY_RAG_AUTH_ALLOWED_DOMAINS",
        configValue("DIFY_RAG_ALLOWED_DOMAINS", "")
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

function fallbackIdentityFromRequest(req) {
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

function bearerTokenFromRequest(req) {
  const auth = firstHeader(req.headers, ["authorization"]);
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice("bearer ".length).trim();
}

function emailDomain(email) {
  const parts = String(email || "").toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function canUseConnector(identity) {
  if (!authEnabled()) return true;
  if (!identity.email) return false;
  if (truthy(configValue("DIFY_RAG_AUTH_ALLOW_ALL", ""))) return true;

  const email = identity.email.toLowerCase();
  const domain = emailDomain(email);
  const hostedDomain = String(identity.hostedDomain || "").toLowerCase();
  const emails = allowedAuthEmails();
  const domains = allowedAuthDomains();
  const addEmails = allowedAddEmails();

  if (!emails.size && !domains.size && !addEmails.size) return false;
  return (
    emails.has(email) ||
    addEmails.has(email) ||
    domains.has(domain) ||
    Boolean(hostedDomain && domains.has(hostedDomain))
  );
}

function canAddKnowledge(identity) {
  const allowed = allowedAddEmails();
  if (!allowed.size) return false;
  return Boolean(identity.email && allowed.has(identity.email.toLowerCase()));
}

async function verifyGoogleBearerToken(token) {
  if (!token) {
    return { ok: false, status: 401, message: "OAuth authentication is required." };
  }

  const cacheKey = createHash("sha256").update(token).digest("hex");
  const cached = tokenIdentityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let response;
  try {
    response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    return {
      ok: false,
      status: 401,
      message: `Could not validate the OAuth token: ${error.message}`,
    };
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 401,
      message: data.error_description || data.error || "Invalid Google OAuth token.",
    };
  }

  const email = String(data.email || "").toLowerCase();
  if (!email) {
    return { ok: false, status: 401, message: "The OAuth token did not include an email address." };
  }
  if (data.email_verified === false || data.email_verified === "false") {
    return { ok: false, status: 403, message: "The Google account email is not verified." };
  }

  const result = {
    ok: true,
    identity: {
      email,
      source: "google-oauth",
      subject: String(data.sub || ""),
      hostedDomain: String(data.hd || "").toLowerCase(),
    },
  };
  tokenIdentityCache.set(cacheKey, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    result,
  });
  return result;
}

async function authenticateRequest(req) {
  if (!authEnabled()) {
    return { ok: true, identity: fallbackIdentityFromRequest(req) };
  }

  if (authProvider !== "google") {
    return {
      ok: false,
      status: 500,
      message: `Unsupported DIFY_RAG_AUTH_PROVIDER: ${authProvider}`,
    };
  }

  const verified = await verifyGoogleBearerToken(bearerTokenFromRequest(req));
  if (!verified.ok) return verified;
  if (!canUseConnector(verified.identity)) {
    return {
      ok: false,
      status: 403,
      message: "This account is not allowed to use this connector.",
    };
  }
  return verified;
}

function requestOrigin(req) {
  const forwardedProto = firstHeader(req.headers, ["x-forwarded-proto"]);
  const hostHeader = firstHeader(req.headers, ["x-forwarded-host", "host"]);
  const fallbackHost = `${host}:${port}`;
  const hostname = hostHeader || fallbackHost;
  const proto =
    forwardedProto ||
    (hostname.startsWith("127.0.0.1") || hostname.startsWith("localhost") ? "http" : "https");
  return `${proto}://${hostname}`;
}

function resourceUrl(req) {
  if (publicMcpUrl) return publicMcpUrl;
  return new URL(mcpPath, requestOrigin(req)).href.replace(/\/+$/, "");
}

function protectedResourceMetadataUrl(req) {
  const resource = new URL(resourceUrl(req));
  const suffix = resource.pathname === "/" ? "" : resource.pathname;
  return `${resource.origin}/.well-known/oauth-protected-resource${suffix}`;
}

function isProtectedResourceMetadataPath(pathname) {
  if (pathname === "/.well-known/oauth-protected-resource") return true;
  const suffix = mcpPath === "/" ? "" : mcpPath;
  return pathname === `/.well-known/oauth-protected-resource${suffix}`;
}

function oauthScopeList() {
  return oauthScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
}

function protectedResourceMetadata(req) {
  const metadata = {
    resource: resourceUrl(req),
    bearer_methods_supported: ["header"],
    scopes_supported: oauthScopeList(),
  };
  if (oauthAuthorizationServer) {
    metadata.authorization_servers = [oauthAuthorizationServer];
  }
  return metadata;
}

function quoteHeaderValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function requestIdFromBody(parsedBody) {
  if (!parsedBody || Array.isArray(parsedBody)) return null;
  return parsedBody.id === undefined ? null : parsedBody.id;
}

function sendOAuthChallenge(req, res, parsedBody, message) {
  res.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": `Bearer resource_metadata="${quoteHeaderValue(
      protectedResourceMetadataUrl(req)
    )}", scope="${quoteHeaderValue(oauthScopes)}", error="invalid_token", error_description="${quoteHeaderValue(
      message
    )}"`,
  });
  res.end(
    JSON.stringify(
      {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message,
        },
        id: requestIdFromBody(parsedBody),
      },
      null,
      2
    )
  );
}

function sendMcpError(res, status, parsedBody, message) {
  sendJson(res, status, {
    jsonrpc: "2.0",
    error: {
      code: status === 403 ? -32003 : -32603,
      message,
    },
    id: requestIdFromBody(parsedBody),
  });
}

function calledToolNames(parsedBody) {
  const requests = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  return requests
    .filter(Boolean)
    .filter((request) => request.method === "tools/call")
    .map((request) => request.params && request.params.name)
    .filter(Boolean);
}

function hasProtectedToolCall(parsedBody) {
  return calledToolNames(parsedBody).some((name) => name === "search_knowledge" || name === "add_knowledge");
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

async function handleMcp(req, res, parsedBody, identity) {
  if (authEnabled() && req.method === "POST") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcpServer = createMcpServer(identity);
    await mcpServer.connect(transport);
    try {
      await transport.handleRequest(req, res, parsedBody);
    } finally {
      await transport.close();
      await mcpServer.close();
    }
    return;
  }

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
        auth_provider: authProvider || "none",
        auth_enabled: authEnabled(),
        auth_allowlist_configured:
          allowedAuthEmails().size > 0 ||
          allowedAuthDomains().size > 0 ||
          allowedAddEmails().size > 0 ||
          truthy(configValue("DIFY_RAG_AUTH_ALLOW_ALL", "")),
        public_url_configured: Boolean(publicMcpUrl),
        add_allowlist_configured: allowedAddEmails().size > 0,
      });
      return;
    }

    if (isProtectedResourceMetadataPath(url.pathname)) {
      sendJson(res, 200, protectedResourceMetadata(req));
      return;
    }

    if (url.pathname !== mcpPath) {
      sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const parsedBody = undefined;
      await handleMcp(req, res, parsedBody, fallbackIdentityFromRequest(req));
      return;
    }

    if (req.method === "POST") {
      const parsedBody = await readJson(req);
      let identity = fallbackIdentityFromRequest(req);
      if (hasProtectedToolCall(parsedBody)) {
        const auth = await authenticateRequest(req);
        if (!auth.ok) {
          if (auth.status === 401) {
            sendOAuthChallenge(req, res, parsedBody, auth.message);
          } else {
            sendMcpError(res, auth.status || 500, parsedBody, auth.message);
          }
          return;
        }
        identity = auth.identity;
      }
      await handleMcp(req, res, parsedBody, identity);
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
