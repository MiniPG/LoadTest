#!/bin/bash
# 카드사 503 구간에서 PG 스레드가 무엇을 기다리는지 확인한다
#   결제 흐름 200/s를 약 4분 걸고, 정상일 때와 카드사 503일 때 스레드 덤프를 떠서 비교
#   1:00 정상 덤프 → 1:30 카드사 503 → 2:00, 2:20 덤프 → 2:50 카드사 정상 → 3:30 덤프
#
# 사용 (LoadTest 레포 루트에서):
#   ./bin/fail-threaddump-run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/../Infra/scripts"
LOG="$ROOT/results/fail-threaddump-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$ROOT/results"

"$INFRA/card-fault.sh" 500 | tee -a "$LOG"

schedule() {
  local start=$1
  at() {
    local offset=$1; shift
    local wait=$(( start + offset - $(date +%s) ))
    [ "$wait" -gt 0 ] && sleep "$wait"
    echo "[일정] 시작 후 ${offset}초: $*" | tee -a "$LOG"
    "$@" 2>&1 | tee -a "$LOG" || true
  }
  at 60 "$INFRA/pg-threaddump.sh"
  at 90 "$INFRA/card-fault.sh" 0 fail
  at 120 "$INFRA/pg-threaddump.sh"
  at 140 "$INFRA/pg-threaddump.sh"
  at 170 "$INFRA/card-fault.sh" 500
  at 210 "$INFRA/pg-threaddump.sh"
}

START=$(date +%s)
schedule "$START" &
SCHEDULER=$!
trap '"$INFRA/card-fault.sh" 500 >/dev/null 2>&1 || true; kill $SCHEDULER 2>/dev/null || true' EXIT

"$ROOT/bin/aws.sh" --quiet -e STEPS=200 -e WARMUP=20s -e RAMP=10s -e HOLD=210s scenarios/capacity.js 2>&1 \
  | grep -v '^time=' | tee -a "$LOG" | tail -5
wait $SCHEDULER || true
echo "로그: $LOG"
