#!/usr/bin/env bash
#
# Quick local health check for the Dify host.
#
set -u

echo "== Dify public frontend =="
curl -s -o /dev/null -w "http://127.0.0.1/ -> %{http_code}\n" --max-time 5 http://127.0.0.1/

echo ""
echo "== dify-rag-gateway =="
curl -s --max-time 5 http://127.0.0.1:8787/health || true
echo ""

echo ""
echo "== launchd =="
launchctl print "gui/$(id -u)/com.atschool.dify-rag-gateway" 2>/dev/null | sed -n '1,35p' || echo "gateway launchd service is not loaded"

echo ""
echo "== cloudflared =="
pgrep -af cloudflared || echo "cloudflared process was not found"
