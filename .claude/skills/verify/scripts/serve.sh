#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

usage() {
	echo "Usage: serve.sh start <app> [--no-build] | stop <app> | status" >&2
	exit 2
}

pidfile() { echo "$VERIFY_ROOT/run/$1.pid"; }

server_cmd() {
	local port
	port="$(verify_port "$1")"
	case "$1" in
	vite-react | tanstack-start) echo "node_modules/.bin/vite preview --port $port --strictPort" ;;
	nextjs-react) echo "node_modules/.bin/next start -p $port" ;;
	esac
}

start() {
	local app="$1" build=1
	[[ "${2:-}" == "--no-build" ]] && build=0
	local port pf log
	port="$(verify_port "$app")"
	pf="$(pidfile "$app")"
	log="$VERIFY_ROOT/run/$app.log"
	mkdir -p "$VERIFY_ROOT/run"

	refuse_if_busy "$app"
	[[ $build -eq 1 ]] && build_app "$app" "$VERIFY_ROOT/run/$app.build.log"

	set -m
	(cd "$REPO_ROOT/examples/$app" && exec $(server_cmd "$app")) >"$log" 2>&1 &
	local pid=$!
	set +m
	echo "$pid" >"$pf"

	for _ in $(seq 60); do
		if curl -sf -o /dev/null "http://localhost:$port/"; then
			echo "$app ready at http://localhost:$port (pgid $pid, log $log)"
			return 0
		fi
		if ! kill -0 "$pid" 2>/dev/null; then
			tail -20 "$log" >&2
			rm -f "$pf"
			echo "$app exited before becoming ready" >&2
			exit 5
		fi
		sleep 1
	done
	echo "$app not ready after 60s; see $log. Run: serve.sh stop $app" >&2
	exit 5
}

stop() {
	local app="$1" pf port pid listener
	pf="$(pidfile "$app")"
	port="$(verify_port "$app")"
	if [[ ! -f "$pf" ]]; then
		echo "No pidfile for $app; nothing started by serve.sh to stop."
		return 0
	fi
	pid="$(cat "$pf")"
	listener="$(listener_pid "$port")"
	if [[ -n "$listener" && "$(ps -o pgid= -p "$listener" | tr -d ' ')" != "$pid" ]]; then
		echo "Port $port is held by pid $listener, which serve.sh did not start. Leaving it alone." >&2
		rm -f "$pf"
		exit 6
	fi
	kill -TERM -- "-$pid" 2>/dev/null || true
	for _ in $(seq 20); do
		[[ -z "$(listener_pid "$port")" ]] && break
		sleep 0.5
	done
	rm -f "$pf"
	if [[ -n "$(listener_pid "$port")" ]]; then
		echo "Port $port still in use after stopping $app" >&2
		exit 6
	fi
	echo "$app stopped; port $port released"
}

status() {
	local app
	for app in "${APPS[@]}"; do
		local port pf pid
		port="$(verify_port "$app")"
		pf="$(pidfile "$app")"
		pid="$(listener_pid "$port")"
		if [[ -f "$pf" ]]; then
			echo "$app: pidfile pgid $(cat "$pf"), port $port listener ${pid:-none}"
		else
			echo "$app: not started by serve.sh, port $port listener ${pid:-none}"
		fi
	done
}

case "${1:-}" in
start)
	[[ $# -ge 2 ]] || usage
	require_app "$2"
	start "$2" "${3:-}"
	;;
stop)
	[[ $# -ge 2 ]] || usage
	require_app "$2"
	stop "$2"
	;;
status) status ;;
*) usage ;;
esac
