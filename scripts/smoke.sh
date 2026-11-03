#!/usr/bin/env bash
# Smoke test a deployed environment: scripts/smoke.sh <api url> <sync url>
set -euo pipefail
api="${1:?api url}"
sync="${2:?sync url}"

check() {
	printf '%-45s' "$1"
	shift
	"$@" >/dev/null && echo ok || { echo FAILED; exit 1; }
}

check "API health" curl -fsS --retry 5 --retry-all-errors "$api/healthz"
check "PWA shell" bash -c "curl -fsS '$api/' | grep -q '<title>Recommendship</title>'"
check "Link preview tags" bash -c "curl -fsS '$api/' | grep -q 'property=\"og:image\"'"
check "Link preview image" curl -fsS "$api/og-image.png"
check "Service worker" curl -fsS "$api/service-worker.js"
check "JWKS (PowerSync verifies tokens with it)" bash -c "curl -fsS '$api/api/auth/jwks' | grep -q EdDSA"
check "Dev sign-in is off" bash -c "curl -fsS '$api/api/public/config' | grep -q '\"devLogin\":false'"
check "API refuses anonymous writes" bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$api/api/write')\" = 401 ]"
check "PowerSync reachable" bash -c "curl -s -o /dev/null --retry 5 --retry-all-errors -w '%{http_code}' '$sync/' | grep -qE '^[2-4]'"
