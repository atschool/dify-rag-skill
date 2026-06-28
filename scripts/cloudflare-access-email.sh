#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  cloudflare-access-email.sh list
  cloudflare-access-email.sh add user@example.com
  cloudflare-access-email.sh remove user@example.com

Required configuration:
  CLOUDFLARE_API_TOKEN or CF_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID or CF_ACCOUNT_ID
  CLOUDFLARE_ACCESS_POLICY_ID or CF_ACCESS_POLICY_ID

Optional local config file:
  ~/.dify-rag/cloudflare-access.env

Example:
  mkdir -p ~/.dify-rag
  cat > ~/.dify-rag/cloudflare-access.env <<'EOF'
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_ACCESS_POLICY_ID=your-policy-id
EOF

Store the API token in macOS Keychain:
  security add-generic-password -a "$USER" -s dify-rag-cloudflare-api-token -w "YOUR_TOKEN" -U
USAGE
}

die() {
  echo "Error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required."
}

is_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

load_local_config() {
  local config_file="${DIFY_RAG_CLOUDFLARE_ACCESS_CONFIG:-$HOME/.dify-rag/cloudflare-access.env}"
  if [[ -f "$config_file" ]]; then
    # shellcheck disable=SC1090
    source "$config_file"
  fi
}

load_token_from_keychain() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}" ]]; then
    return
  fi
  if command -v security >/dev/null 2>&1; then
    CLOUDFLARE_API_TOKEN="$(security find-generic-password -s dify-rag-cloudflare-api-token -w 2>/dev/null || true)"
    export CLOUDFLARE_API_TOKEN
  fi
}

api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local args=(-sS -X "$method" "$url" -H "Authorization: Bearer $TOKEN")

  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" --data-binary @"$body")
  fi

  curl "${args[@]}"
}

policy_url() {
  printf 'https://api.cloudflare.com/client/v4/accounts/%s/access/policies/%s' "$ACCOUNT_ID" "$POLICY_ID"
}

fetch_policy() {
  api GET "$(policy_url)" |
    jq '
      if .success == true then
        .result
      else
        error("Cloudflare API error: " + (.errors | tostring))
      end
    '
}

policy_payload() {
  jq '{
    name,
    decision,
    include,
    exclude,
    require,
    session_duration,
    approval_required,
    purpose_justification_required,
    purpose_justification_prompt
  } | with_entries(select(.value != null))'
}

extract_email() {
  jq -r '
    .include[]?
    | select(type == "object" and has("email"))
    | .email.email // empty
  '
}

update_policy() {
  local payload_file="$1"
  api PUT "$(policy_url)" "$payload_file" |
    jq '
      if .success == true then
        {
          success,
          policy: .result.name,
          include_emails: [
            .result.include[]?
            | select(type == "object" and has("email"))
            | .email.email
          ]
        }
      else
        {
          success,
          errors
        }
      end
    '
}

main() {
  local command="${1:-}"
  local email="${2:-}"

  if [[ -z "$command" || "$command" == "-h" || "$command" == "--help" ]]; then
    usage
    exit 0
  fi

  need_cmd curl
  need_cmd jq

  load_local_config
  load_token_from_keychain

  TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
  ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
  POLICY_ID="${CLOUDFLARE_ACCESS_POLICY_ID:-${CF_ACCESS_POLICY_ID:-}}"

  [[ -n "$TOKEN" ]] || die "CLOUDFLARE_API_TOKEN is not set and no token was found in Keychain."
  [[ -n "$ACCOUNT_ID" ]] || die "CLOUDFLARE_ACCOUNT_ID is not set."
  [[ -n "$POLICY_ID" ]] || die "CLOUDFLARE_ACCESS_POLICY_ID is not set."

  local policy_file
  policy_file="$(mktemp)"
  trap 'rm -f "$policy_file" "${payload_file:-}"' EXIT
  fetch_policy > "$policy_file"

  case "$command" in
    list)
      extract_email < "$policy_file"
      ;;
    add)
      [[ -n "$email" ]] || die "email is required."
      is_email "$email" || die "invalid email: $email"
      payload_file="$(mktemp)"
      jq --arg email "$email" '
        .include = ((.include // []) + [{"email": {"email": $email}}] | unique_by(tojson))
      ' "$policy_file" | policy_payload > "$payload_file"
      update_policy "$payload_file"
      ;;
    remove)
      [[ -n "$email" ]] || die "email is required."
      is_email "$email" || die "invalid email: $email"
      payload_file="$(mktemp)"
      jq --arg email "$email" '
        .include = [
          (.include // [])[]
          | select((has("email") and .email.email == $email) | not)
        ]
      ' "$policy_file" | policy_payload > "$payload_file"
      update_policy "$payload_file"
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
