#!/usr/bin/env bash
set -euo pipefail

# The wrapper behind `pnpm tauri`. It re-patches the Xcode project before every
# `ios` command (XCODE_PROJECT.md), tells the frontend whether this build opens a
# graph off the device (docs/ARCHITECTURE.md § "Local-only mode"), and can front
# the local API on the public https origin a physical device needs.
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

# ── Local mode ───────────────────────────────────────────────────────────────
SLOPPY_LOCAL_MODE="${SLOPPY_LOCAL_MODE:-$(read_env SLOPPY_LOCAL_MODE)}"
if is_true "$SLOPPY_LOCAL_MODE"; then LOCAL_MODE=true; else LOCAL_MODE=false; fi

export PUBLIC_ENABLE_LOCAL_MODE="$LOCAL_MODE"

# ── A reachable API for a physical device ────────────────────────────────────
# An https origin, because iOS refuses plain http to a LAN address as readily as
# to a remote one — docs/ARCHITECTURE.md § "Native shell" carries the why.
#
# TODO(apps/sloppy/api): sign-in needs the syr instance on this same origin —
# the device's browser cannot reach one on this LAN either. Fronting it is a
# route on the API, not a second tunnel, or the origin stops being one.
SLOPPY_DEV_TUNNEL="${SLOPPY_DEV_TUNNEL:-$(read_env SLOPPY_DEV_TUNNEL)}"
CF_TUNNEL_NAME="${CF_TUNNEL_NAME:-$(read_env CF_TUNNEL_NAME)}"
CF_TUNNEL_HOSTNAME="${CF_TUNNEL_HOSTNAME:-$(read_env CF_TUNNEL_HOSTNAME)}"
API_PORT="${SLOPPY_API_PORT:-$(read_env SLOPPY_API_PORT)}"
API_PORT="${API_PORT:-8020}"

wants_tunnel() {
	[[ "$PLATFORM" =~ ^(ios|android)$ && "$ACTION" == "dev" ]] &&
		{ is_true "${SLOPPY_DEV_TUNNEL:-}" || [[ -n "$CF_TUNNEL_NAME" ]]; }
}

# Only the API answers /api/health with a report: Cloudflare's edge replies on its
# own for a hostname it has not published, so "something replied" proves nothing.
api_answers() {
	local body
	body="$(curl -s --max-time 5 "${1}/api/health" || true)"
	[[ "$body" == *'"checks"'* ]]
}

if wants_tunnel; then
	command -v cloudflared >/dev/null 2>&1 || {
		echo "✗ cloudflared is not installed (brew install cloudflared)" >&2
		exit 1
	}
	api_answers "http://localhost:${API_PORT}" || {
		echo "✗ The API isn't answering on :${API_PORT} — start it first (pnpm dev:api)" >&2
		exit 1
	}

	LOG="$(mktemp -t sloppy-tunnel.XXXXXX)"
	TUNNEL_PID=""
	TUNNEL_URL=""
	reachable=""

	# cloudflared's own answer to "is the edge holding my connection", off the
	# metrics server it logs at startup — no DNS, no round trip back through the
	# edge, so it is the one readiness signal this host can actually observe.
	cloudflared_connected() {
		local metrics
		metrics="$(sed -n 's/.*metrics server on \([0-9.]*:[0-9]*\).*/\1/p' "$LOG" | tail -1)"
		[[ -n "$metrics" ]] && curl -sf -o /dev/null --max-time 2 "http://${metrics}/ready"
	}

	if [[ -n "$CF_TUNNEL_NAME" ]]; then
		# A named tunnel is stable across runs and prints no URL of its own, so its
		# hostname has to be given; its ingress must forward to the API port.
		[[ -n "$CF_TUNNEL_HOSTNAME" ]] || {
			echo "✗ CF_TUNNEL_NAME is set but CF_TUNNEL_HOSTNAME is empty — set both in .env" >&2
			exit 1
		}
		TUNNEL_URL="https://${CF_TUNNEL_HOSTNAME#*://}"
		TUNNEL_URL="${TUNNEL_URL%/}"
		if api_answers "$TUNNEL_URL"; then
			reachable=1
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

	if [[ -n "$TUNNEL_PID" ]]; then
		connected=""
		for _ in $(seq 1 60); do
			kill -0 "$TUNNEL_PID" 2>/dev/null || break
			if [[ -z "$CF_TUNNEL_NAME" ]]; then
				# A quick tunnel prints its assigned hostname once the edge issues it.
				TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
			fi
			if [[ -n "$TUNNEL_URL" ]] && cloudflared_connected; then
				connected=1
				break
			fi
			sleep 1
		done
		[[ -n "$connected" ]] || {
			echo "✗ cloudflared never reached the Cloudflare edge; it said:" >&2
			cat "$LOG" >&2
			exit 1
		}

		# The edge publishes a fresh hostname minutes after it accepts the connection
		# behind it, and the device resolves that name over its own network — so this
		# is a report on what one host can see, never a gate.
		for _ in $(seq 1 5); do
			if api_answers "$TUNNEL_URL"; then
				reachable=1
				break
			fi
			sleep 2
		done
	fi

	# An origin, never a path: @sloppy/client owns everything after it.
	export PUBLIC_SLOPPY_API_URL="$TUNNEL_URL"
	echo "── Sloppy mobile dev ────────────────────────────────"
	echo "   API   $TUNNEL_URL   baked in as PUBLIC_SLOPPY_API_URL"
	[[ -n "$reachable" ]] ||
		echo "   …not answering from this machine yet; the device may get there first"
	echo "─────────────────────────────────────────────────────"

	# A child, not exec, so the trap still tears the tunnel down.
	pnpm exec tauri "$@"
	exit $?
fi

exec pnpm exec tauri "$@"
