#!/usr/bin/env bash
#
# Quick local health check for the Remote MCP host.
#
set -u

echo "== dify-rag-gateway =="
curl -s --max-time 5 http://127.0.0.1:8787/health || true
echo ""

echo ""
echo "== dify-rag-remote-mcp =="
curl -s --max-time 5 http://127.0.0.1:8788/health || true
echo ""

echo ""
echo "== launchd: gateway =="
launchctl print "gui/$(id -u)/com.atschool.dify-rag-gateway" 2>/dev/null | sed -n '1,35p' || echo "gateway launchd service is not loaded"

echo ""
echo "== launchd: remote mcp =="
launchctl print "gui/$(id -u)/com.atschool.dify-rag-remote-mcp" 2>/dev/null | sed -n '1,35p' || echo "remote mcp launchd service is not loaded"

echo ""
echo "== cloudflared =="
pgrep -af cloudflared || echo "cloudflared process was not found"
