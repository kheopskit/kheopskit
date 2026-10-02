#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [[ $# -lt 2 ]]; then
	echo "Usage: run.sh <vite-react|nextjs-react|tanstack-start> <spec-file> [--no-build] [playwright args...]" >&2
	exit 2
fi

app="$1"
spec="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
shift 2
require_app "$app"
[[ -f "$spec" ]] || {
	echo "Spec not found: $spec" >&2
	exit 2
}

build=1
if [[ "${1:-}" == "--no-build" ]]; then
	build=0
	shift
fi

refuse_if_busy "$app"

run_id="$(date +%Y%m%d-%H%M%S)-$app-$(basename "$spec" .spec.ts)"
evidence="$VERIFY_ROOT/evidence/$run_id"
mkdir -p "$evidence"
cp "$spec" "$evidence/"
git -C "$REPO_ROOT" rev-parse HEAD >"$evidence/git-head.txt"
git -C "$REPO_ROOT" status --short >>"$evidence/git-head.txt"

[[ $build -eq 1 ]] && build_app "$app" "$evidence/build.log"

set +e
VERIFY_APP="$app" VERIFY_SPEC="$spec" VERIFY_EVIDENCE_DIR="$evidence" \
	pnpm --dir "$REPO_ROOT" exec playwright test \
	-c .claude/skills/verify/playwright.config.ts "$@" 2>&1 | tee "$evidence/playwright.log"
status=${PIPESTATUS[0]}
set -e

echo
echo "Evidence: $evidence"
echo "Trace:    pnpm exec playwright show-trace $evidence/artifacts/<test-dir>/trace.zip"
exit "$status"
