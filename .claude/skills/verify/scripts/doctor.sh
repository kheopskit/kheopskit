#!/usr/bin/env bash
set -uo pipefail
source "$(dirname "$0")/lib.sh"

failures=0
ok() { echo "OK    $*"; }
warn() { echo "WARN  $*"; }
fail() {
	echo "FAIL  $*"
	failures=$((failures + 1))
}

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if ((node_major >= 24)); then ok "node $(node -v)"; else fail "node >=24 required (have $(node -v 2>/dev/null || echo none))"; fi

if [[ -d "$REPO_ROOT/node_modules/@playwright/test" ]]; then
	ok "@playwright/test $(node -p "require('$REPO_ROOT/node_modules/@playwright/test/package.json').version")"
else
	fail "@playwright/test missing; run pnpm install"
fi

chromium_dirs="$(cd "$REPO_ROOT" && pnpm exec playwright install --dry-run chromium 2>/dev/null | awk '/Install location:/ {print $3}')"
missing=""
for dir in $chromium_dirs; do [[ -d "$dir" ]] || missing="$missing $dir"; done
if [[ -z "$chromium_dirs" ]]; then
	warn "could not resolve Playwright chromium location"
elif [[ -n "$missing" ]]; then
	fail "Playwright chromium not installed:$missing (run: pnpm exec playwright install chromium)"
else
	ok "Playwright chromium installed"
fi

for pkg in core react; do
	dist="$REPO_ROOT/packages/$pkg/dist/index.mjs"
	if [[ ! -f "$dist" ]]; then
		warn "packages/$pkg not built (run.sh builds it)"
	elif [[ -n "$(find "$REPO_ROOT/packages/$pkg/src" -newer "$dist" -type f | head -1)" ]]; then
		warn "packages/$pkg/dist older than src (run.sh rebuilds; --no-build would drive stale code)"
	else
		ok "packages/$pkg/dist up to date"
	fi
done

app_marker() {
	case "$1" in
	vite-react) echo "$REPO_ROOT/examples/vite-react/dist/index.html" ;;
	nextjs-react) echo "$REPO_ROOT/examples/nextjs-react/.next/BUILD_ID" ;;
	tanstack-start) echo "$REPO_ROOT/examples/tanstack-start/dist/client" ;;
	esac
}

for app in "${APPS[@]}"; do
	marker="$(app_marker "$app")"
	if [[ ! -e "$marker" ]]; then
		warn "$app has no production build (run.sh builds it)"
	elif [[ -n "$(find "$REPO_ROOT/packages/core/dist" "$REPO_ROOT/packages/react/dist" "$REPO_ROOT/examples/$app/src" -newer "$marker" -type f 2>/dev/null | head -1)" ]]; then
		warn "$app build older than its sources (run.sh rebuilds; --no-build would drive stale code)"
	else
		ok "$app build up to date"
	fi

	for kind in verify e2e dev; do
		port="$("${kind}_port" "$app")"
		pid="$(listener_pid "$port")"
		[[ -z "$pid" ]] && continue
		cmd="$(ps -o command= -p "$pid" | cut -c1-80)"
		pf="$VERIFY_ROOT/run/$app.pid"
		if [[ "$kind" == verify && -f "$pf" && "$(ps -o pgid= -p "$pid" | tr -d ' ')" == "$(cat "$pf")" ]]; then
			ok "$app verify port $port served by serve.sh (pid $pid)"
		elif [[ "$kind" == dev ]]; then
			ok "$app dev server on $port (pid $pid) is not ours; verification does not touch it"
		else
			fail "$app $kind port $port held by pid $pid ($cmd); run.sh/serve.sh will refuse to build $app"
		fi
	done
done

for pf in "$VERIFY_ROOT"/run/*.pid; do
	[[ -f "$pf" ]] || continue
	kill -0 "$(cat "$pf")" 2>/dev/null || warn "stale pidfile $pf (process gone); run serve.sh stop $(basename "$pf" .pid)"
done

echo
if ((failures)); then
	echo "doctor: $failures failure(s)"
	exit 1
fi
echo "doctor: ready"
