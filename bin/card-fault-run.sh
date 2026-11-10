#!/bin/bash
# 카드사 장애 실험: 부하(scenarios/card-fault.js)를 걸면서 정해진 시각에 카드사 장애를 켜고 끈다
#   장애 시각은 card-fault.js의 PHASES와 맞춘다 (예열 3분 + 증가 30초 뒤부터)
#   normal 2분 → slow(2.5초) 1분 → 회복 2분 → hang(10초) 1분 → 회복 3분 → fail(503) 1분 → 회복 2분
#
# 사용 (LoadTest 레포 루트에서):
#   ./bin/card-fault-run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAULT="$ROOT/../Infra/scripts/card-fault.sh"
LOG="$ROOT/results/card-fault-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$ROOT/results"

"$FAULT" 500 | tee -a "$LOG"

schedule() {
  local start=$1
  at() {
    local offset=$1; shift
    local wait=$(( start + offset - $(date +%s) ))
    [ "$wait" -gt 0 ] && sleep "$wait"
    echo "[장애 일정] 시작 후 ${offset}초: $*" | tee -a "$LOG"
    "$FAULT" "$@" 2>&1 | tee -a "$LOG" || true
  }
  at 330 2500
  at 390 500
  at 510 10000
  at 570 500
  at 750 0 fail
  at 810 500
}

START=$(date +%s)
schedule "$START" &
SCHEDULER=$!
trap '"$FAULT" 500 >/dev/null 2>&1 || true; kill $SCHEDULER 2>/dev/null || true' EXIT

"$ROOT/bin/aws.sh" scenarios/card-fault.js 2>&1 | tee -a "$LOG"
wait $SCHEDULER || true
echo "로그: $LOG"
