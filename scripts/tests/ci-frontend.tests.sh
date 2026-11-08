#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$repo/.local"
suite=$(mktemp -d "$repo/.local/frontend-ci-mock-XXXXXX")
npm() {
  printf '%s\n' "$*" >> "$CASE_LOG"
  if [[ "$SCENARIO" == install && "$1" == ci ]]; then return 12; fi
  if [[ "$SCENARIO" == test && "$1" == test ]]; then return 13; fi
  if [[ "$SCENARIO" == lint && "$*" == 'run lint -- --no-fix' ]]; then return 14; fi
  if [[ "$SCENARIO" == build && "$*" == 'run build:production' ]]; then return 15; fi
  if [[ "$SCENARIO" == package && "$*" == 'run package:vercel' ]]; then return 16; fi
  [[ "$1" != test ]] || printf 'TAP version 13\nok 1 - mock\n1..1\n'
  return 0
}
export -f npm
for scenario in success install test lint build package; do
  folder="$suite/$scenario"
  mkdir -p "$folder/.local/frontend"
  export SCENARIO="$scenario" CASE_LOG="$folder/commands.log"
  : > "$CASE_LOG"
  set +e
  (cd "$folder" && bash "$repo/scripts/ci-frontend.sh") > "$folder/output.log" 2>&1
  code=$?
  set -e
  if [[ "$scenario" == success ]]; then [[ "$code" == 0 ]]; else [[ "$code" != 0 ]]; fi
  [[ -f "$folder/.local/frontend-ci.json" ]]
  if [[ "$scenario" =~ ^(install|test|lint|build)$ ]]; then ! grep -q '^run package:vercel$' "$CASE_LOG"; fi
  printf 'PASS %s\n' "$scenario"
done
echo '6 FE CI 모의 시나리오 통과. 실제 npm/Vercel 호출 없음.'
