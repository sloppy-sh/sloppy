#!/usr/bin/env bash
set -euo pipefail

# The wrapper behind `pnpm tauri`. It re-patches the Xcode project before every
# `ios` command (XCODE_PROJECT.md), derives both halves of local mode from
# SLOPPY_LOCAL_MODE (docs/ARCHITECTURE.md § "Local-only mode"), and can front the
# local API on a public https origin for a device that is not on this LAN.
#
# Values come from the monorepo-root .env; a shell variable of the same name wins.

cd "$(dirname "$0")/.."
ROOT="$(cd ../../.. && pwd)"
ROOT_ENV="$ROOT/.env"

# Read one KEY=value without sourcing: .env values may contain shell
# metacharacters, so a blanket `source` is not safe.
read_env() {
	[[ -f "$ROOT_ENV" ]] || return 0
	grep -E "^${1}=" "$ROOT_ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# macOS ships bash 3.2, which has no ${var,,}.
is_true() { [[ "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" =~ ^(1|true|yes|on)$ ]]; }

PLATFORM="${1:-}"
SUBCOMMAND="${2:-}"
if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "android" ]]; then
	ACTION="$SUBCOMMAND"
else
	ACTION="$PLATFORM"
fi

# ── The Xcode project, re-patched before anything reads it ───────────────────
if [[ "$PLATFORM" == "ios" ]]; then
	if [[ "$ACTION" == "init" ]]; then
		pnpm exec tauri "$@"
		exec node ./scripts/patch-xcode-project.mjs
	fi
	if [[ -f src-tauri/gen/apple/project.yml ]]; then
		node ./scripts/patch-xcode-project.mjs
	fi
fi

# ── Local mode: one value, both halves ───────────────────────────────────────
SLOPPY_LOCAL_MODE="${SLOPPY_LOCAL_MODE:-$(read_env SLOPPY_LOCAL_MODE)}"
if [[ -z "$SLOPPY_LOCAL_MODE" && "$ACTION" == "dev" ]]; then SLOPPY_LOCAL_MODE=true; fi
if is_true "$SLOPPY_LOCAL_MODE"; then LOCAL_MODE=true; else LOCAL_MODE=false; fi

export PUBLIC_ENABLE_LOCAL_MODE="$LOCAL_MODE"
if [[ "$LOCAL_MODE" == true ]] && [[ "$ACTION" == "dev" || "$ACTION" == "build" ]]; then
	set -- "$@" --features local-mode
fi

# ── A reachable API for a device on somebody else's network ──────────────────
# iOS refuses plain http to an arbitrary host, so the LAN address is no help
# either; it has to be an https origin.
#
# TODO(apps/sloppy/api): docs/ARCHITECTURE.md § "Native shell" has this one
# origin also carrying syr, which sign-in needs — the device's browser cannot
# reach a syr instance on this LAN either. Fronting it is a route on the API,
# not a second tunnel, or the origin stops being one.
SLOPPY_DEV_TUNNEL="${SLOPPY_DEV_TUNNEL:-$(read_env SLOPPY_DEV_TUNNEL)}"
CF_TUNNEL_NAME="${CF_TUNNEL_NAME:-$(read_env CF_TUNNEL_NAME)}"
CF_TUNNEL_HOSTNAME="${CF_TUNNEL_HOSTNAME:-$(read_env CF_TUNNEL_HOSTNAME)}"
API_PORT="${SLOPPY_API_PORT:-$(read_env SLOPPY_API_PORT)}"
API_PORT="${API_PORT:-8020}"

wants_tunnel() {
	[[ "$PLATFORM" =~ ^(ios|android)$ && "$ACTION" == "dev" ]] &&
		{ is_true "${SLOPPY_DEV_TUNNEL:-}" || [[ -n "$CF_TUNNEL_NAME" ]]; }
}

if wants_tunnel; then
	command -v cloudflared >/dev/null 2>&1 || {
		echo "✗ cloudflared is not installed (brew install cloudflared)" >&2
		exit 1
	}
	# Any HTTP reply means the API is answering; `curl -f` would read a 404 as a
	# failure, while a refused connection still fails here.
	curl -s -o /dev/null --max-time 3 "http://localhost:${API_PORT}/api/health" || {
		echo "✗ The API isn't answering on :${API_PORT} — start it first (pnpm dev:api)" >&2
		exit 1
	}

	LOG="$(mktemp -t sloppy-tunnel.XXXXXX)"
	TUNNEL_PID=""
	TUNNEL_URL=""

	if [[ -n "$CF_TUNNEL_NAME" ]]; then
		# A named tunnel is stable across runs and prints no URL of its own, so its
		# hostname has to be given; its ingress must forward to the API port.
		[[ -n "$CF_TUNNEL_HOSTNAME" ]] || {
			echo "✗ CF_TUNNEL_NAME is set but CF_TUNNEL_HOSTNAME is empty — set both in .env" >&2
			exit 1
		}
		TUNNEL_URL="https://${CF_TUNNEL_HOSTNAME#*://}"
		TUNNEL_URL="${TUNNEL_URL%/}"
		if curl -s -o /dev/null --max-time 3 "$TUNNEL_URL/api/health"; then
			echo "── Reusing the running tunnel '$CF_TUNNEL_NAME' → $TUNNEL_URL"
		else
			echo "── Starting tunnel '$CF_TUNNEL_NAME' → $TUNNEL_URL"
			cloudflared tunnel run "$CF_TUNNEL_NAME" >"$LOG" 2>&1 &
			TUNNEL_PID=$!
		fi
	else
		cloudflared tunnel --url "http://localhost:${API_PORT}" --no-autoupdate >"$LOG" 2>&1 &
		TUNNEL_PID=$!
	fi

	cleanup() {
		# Never tear down a tunnel this run did not start.
		if [[ -n "$TUNNEL_PID" ]]; then
			kill "$TUNNEL_PID" 2>/dev/null || true
			wait "$TUNNEL_PID" 2>/dev/null || true
		fi
		rm -f "$LOG"
	}
	trap cleanup EXIT INT TERM

	ready=""
	for _ in $(seq 1 30); do
		if [[ -z "$CF_TUNNEL_NAME" ]]; then
			# A quick tunnel prints its assigned hostname once the edge connects.
			TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
		fi
		if [[ -n "$TUNNEL_URL" ]] &&
			curl -s -o /dev/null --max-time 3 "$TUNNEL_URL/api/health"; then
			ready=1
			break
		fi
		sleep 1
	done
	[[ -n "$ready" ]] || {
		echo "✗ The tunnel never answered end to end; cloudflared said:" >&2
		cat "$LOG" >&2
		exit 1
	}

	# An origin, never a path: @sloppy/client owns everything after it.
	export PUBLIC_SLOPPY_API_URL="$TUNNEL_URL"
	echo "── Sloppy mobile dev ────────────────────────────────"
	echo "   API   $TUNNEL_URL   baked in as PUBLIC_SLOPPY_API_URL"
	echo "─────────────────────────────────────────────────────"

	# A child, not exec, so the trap still tears the tunnel down.
	pnpm exec tauri "$@"
	exit $?
fi

exec pnpm exec tauri "$@"
