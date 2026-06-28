# Set Up The Access Allowlist Admin Command

Use this runbook for administrators who add or remove users from a Cloudflare Access policy for gateway or operator-only routes.

Regular connector users do not need this command. Windows users do not need it unless they also manage the Cloudflare Access allowlist.

## What The Command Does

`rag-access-email` edits one Cloudflare Access policy:

```bash
rag-access-email list
rag-access-email add user@example.com
rag-access-email remove user@example.com
```

This controls the selected Cloudflare Access policy. Remote MCP connector access is controlled separately by `DIFY_RAG_AUTH_ALLOWED_EMAILS` and `DIFY_RAG_AUTH_ALLOWED_DOMAINS`. Write permission is controlled separately by `DIFY_RAG_ADD_ALLOWED_EMAILS` on the Dify host.

## Install The Shortcut

From the repository:

```bash
./scripts/install-admin-command.sh
```

If `/usr/local/bin` is not writable, install to a user-local directory:

```bash
DIFY_RAG_ADMIN_BIN_DIR="$HOME/.local/bin" ./scripts/install-admin-command.sh
```

Make sure that directory is in `PATH`.

## Store Non-Secret IDs

Create:

```bash
mkdir -p ~/.dify-rag
cat > ~/.dify-rag/cloudflare-access.env <<'EOF'
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_ACCESS_POLICY_ID=your-policy-id
EOF
chmod 600 ~/.dify-rag/cloudflare-access.env
```

These IDs are not API tokens, but keep them local unless there is a reason to share them.

## Store The API Token On macOS

Create a Cloudflare API token with permission to read and edit Access policies. Then store it in Keychain:

```bash
security add-generic-password \
  -a "$USER" \
  -s dify-rag-cloudflare-api-token \
  -w "YOUR_CLOUDFLARE_API_TOKEN" \
  -U
```

Do not paste the real token into repository files.

## Environment Variable Alternative

For short-lived sessions:

```bash
export CLOUDFLARE_API_TOKEN="YOUR_CLOUDFLARE_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_ACCESS_POLICY_ID="your-policy-id"
```

Then run:

```bash
rag-access-email list
```

Unset the token when done:

```bash
unset CLOUDFLARE_API_TOKEN
```

## Smoke Test

```bash
rag-access-email list
```

Add a test user:

```bash
rag-access-email add user@example.com
rag-access-email list
```

Remove the test user:

```bash
rag-access-email remove user@example.com
```

If the command fails, check:

- `jq` is installed.
- The API token has Access policy write permission.
- `CLOUDFLARE_ACCOUNT_ID` is correct.
- `CLOUDFLARE_ACCESS_POLICY_ID` points to the intended policy.
