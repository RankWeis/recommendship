#!/usr/bin/env bash
# Set the Fly secrets for one environment:
#   scripts/fly-secrets.sh staging|production            everything
#   scripts/fly-secrets.sh staging|production --sync     only PowerSync's two database URLs
#   scripts/fly-secrets.sh staging|production --google   only the Google OAuth client
#   scripts/fly-secrets.sh staging|production --tmdb     only the TMDB token (movie and TV lookup)
#
# BETTER_AUTH_SECRET is generated once per environment and then kept: it encrypts
# the JWT signing key stored in the database, so replacing it would break sync tokens.
#
# Prompts for each value (hidden as you type) and sends it straight to Fly, so
# connection strings and OAuth secrets never land in a file or your shell history.
# You paste one Neon connection string (the owner's); the PowerSync URLs are built
# from its host plus the two role passwords, so there's nothing to edit by hand.
# Secrets are staged: they take effect on the next deploy.
set -euo pipefail

env="${1:-}"
case "$env" in
	staging) prefix=recommendship-staging ;;
	production) prefix=recommendship ;;
	*) echo "usage: $0 staging|production [--sync|--google|--tmdb]" >&2; exit 1 ;;
esac
mode="${2:-all}"

ask() { # name, prompt → sets the variable named $1
	local value
	read -r -s -p "$2: " value
	echo
	[[ -n "$value" ]] || { echo "  (required)" >&2; exit 1; }
	printf -v "$1" '%s' "$value"
}

ask_google() {
	echo "Google OAuth client (Google Cloud console → Google Auth Platform → Clients)."
	ask GOOGLE_CLIENT_ID "Client ID"
	ask GOOGLE_CLIENT_SECRET "Client secret"
}

if [[ "$mode" == --tmdb ]]; then
	echo "TMDB → Settings → API → 'API Read Access Token' (the long one, not the short API key)."
	ask TMDB_READ_TOKEN "API Read Access Token"
	fly secrets set --stage -a "$prefix-api" TMDB_READ_TOKEN="$TMDB_READ_TOKEN" >/dev/null
	echo "Staged TMDB token on $prefix-api. It takes effect on the next deploy."
	exit 0
fi

if [[ "$mode" == --google ]]; then
	ask_google
	fly secrets set --stage -a "$prefix-api" GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" >/dev/null
	echo "Staged Google client on $prefix-api."
	exit 0
fi

branch=$([[ "$env" == production ]] && echo production || echo staging)  # Neon's default branch is called 'production' (older projects: 'main')
echo "Neon → Connect → branch '$branch', database 'neondb', role 'neondb_owner'. Copy the connection string."
ask APP_URL "App database URL"
ask PS_PASSWORD "powersync_role password"
ask STORAGE_PASSWORD "powersync_storage_user password"

# Build the PowerSync URLs from the owner URL: same Neon endpoint, direct (no pooler),
# each with its own role. Values go through stdin, not argv, so they don't show in `ps`.
urls=$(printf '%s\n%s\n%s\n' "$APP_URL" "$PS_PASSWORD" "$STORAGE_PASSWORD" | python3 -c '
import sys, urllib.parse as up
app, pw1, pw2 = sys.stdin.read().split("\n")[:3]
u = up.urlsplit(app.strip().strip("\x27\""))
if u.scheme not in ("postgres", "postgresql") or not u.hostname or "neon.tech" not in u.hostname:
    sys.exit("That does not look like a Neon connection string (postgresql://...neon.tech/...).")
host = u.hostname.replace("-pooler", "")
q = lambda s: up.quote(s, safe="")
# The app URL, minus channel_binding (node-postgres may not accept it).
params = [(k, v) for k, v in up.parse_qsl(u.query) if k != "channel_binding"] or [("sslmode", "require")]
print(up.urlunsplit((u.scheme, u.netloc, u.path, up.urlencode(params), "")))
print(f"postgresql://powersync_role:{q(pw1)}@{host}/neondb?sslmode=require")
print(f"postgresql://powersync_storage_user:{q(pw2)}@{host}/powersync_storage?sslmode=require")
')
DATABASE_URL=$(sed -n 1p <<<"$urls")
PS_SOURCE_DB_URI=$(sed -n 2p <<<"$urls")
PS_STORAGE_DB_URI=$(sed -n 3p <<<"$urls")
echo "Neon endpoint: $(sed -E 's#.*@([^/]+)/.*#\1#' <<<"$PS_SOURCE_DB_URI") (direct)"

fly secrets set --stage -a "$prefix-sync" \
	PS_SOURCE_DB_URI="$PS_SOURCE_DB_URI" \
	PS_STORAGE_DB_URI="$PS_STORAGE_DB_URI" >/dev/null
echo "Staged PowerSync secrets on $prefix-sync."
[[ "$mode" == --sync ]] && exit 0

echo
ask_google
read -r -p "Admin emails (comma-separated, approved on sign-up): " ADMIN_EMAILS
[[ -n "$ADMIN_EMAILS" ]] || { echo "  (required)" >&2; exit 1; }

secrets=(
	DATABASE_URL="$DATABASE_URL"
	GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"
	GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
	ADMIN_EMAILS="$ADMIN_EMAILS"
)
# Generate the signing secret only the first time (see the note at the top).
if fly secrets list -a "$prefix-api" --json | grep -q '"BETTER_AUTH_SECRET"'; then
	echo "Keeping the existing BETTER_AUTH_SECRET."
else
	secrets+=(BETTER_AUTH_SECRET="$(openssl rand -hex 32)")
fi

fly secrets set --stage -a "$prefix-api" "${secrets[@]}" >/dev/null
echo "Staged API secrets on $prefix-api."
