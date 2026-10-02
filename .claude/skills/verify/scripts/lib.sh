REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
VERIFY_ROOT="$REPO_ROOT/.verify"
APPS=(vite-react nextjs-react tanstack-start)

verify_port() {
	case "$1" in
	vite-react) echo 4201 ;;
	nextjs-react) echo 4202 ;;
	tanstack-start) echo 4203 ;;
	*) return 1 ;;
	esac
}

e2e_port() {
	case "$1" in
	vite-react) echo 4101 ;;
	nextjs-react) echo 4102 ;;
	tanstack-start) echo 4103 ;;
	*) return 1 ;;
	esac
}

dev_port() {
	case "$1" in
	vite-react) echo 3001 ;;
	nextjs-react) echo 3002 ;;
	tanstack-start) echo 3003 ;;
	*) return 1 ;;
	esac
}

require_app() {
	if ! verify_port "$1" >/dev/null 2>&1; then
		echo "Unknown app '$1'. Expected one of: ${APPS[*]}" >&2
		exit 2
	fi
}

listener_pid() {
	{ lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true; } | head -1
}

refuse_if_busy() {
	local app="$1" port
	for port in "$(verify_port "$app")" "$(e2e_port "$app")"; do
		local pid
		pid="$(listener_pid "$port")"
		if [[ -n "$pid" ]]; then
			echo "Port $port is in use by pid $pid ($(ps -o command= -p "$pid" | cut -c1-80))." >&2
			echo "Rebuilding $app would swap files under that server. Stop it or wait for it to finish." >&2
			exit 3
		fi
	done
}

build_app() {
	local app="$1" log="$2"
	echo "Building @kheopskit packages and $app (log: $log)"
	if ! (cd "$REPO_ROOT" && pnpm build:packages && pnpm --filter "$app" build) >"$log" 2>&1; then
		tail -30 "$log" >&2
		echo "Build failed. Full log: $log" >&2
		exit 4
	fi
}
