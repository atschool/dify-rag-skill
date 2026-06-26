#!/usr/bin/env node

import { spawn } from "node:child_process";
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

function runSearchScript(args) {
  const script = findSearchScript();
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
        `dify_search.py exited with code ${code}.`,
        stderr.trim(),
        stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(message));
    });
  });
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
  "list_dify_datasets",
  {
    title: "List Dify Datasets",
    description:
      "List Dify datasets visible to the configured Knowledge Base API key.",
    inputSchema: {},
  },
  async () => {
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

