#!/bin/bash
# 스파이크 실험 중 PG DB가 시간을 어디에 쓰는지 잰다
#   spike.js(SPIKES=400)를 돌리면서 순간 부하 한가운데(시작 후 315초)에 diagnose-pg-db.sh를 30초 실행
#
# 사용 (LoadTest 레포 루트에서):
#   ./bin/spike-diagnose-run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/../Infra/scripts"
LOG="$ROOT/results/spike-diagnose-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$ROOT/results"

START=$(date +%s)
(
  wait=$(( START + 315 - $(date +%s) ))
  [ "$wait" -gt 0 ] && sleep "$wait"
  echo "[일정] 시작 후 315초: PG DB 진단 30초" | tee -a "$LOG"
  SEC=30 "$INFRA/diagnose-pg-db.sh" "$ROOT/results" 2>&1 | tee -a "$LOG" || true
) &
DIAG=$!
trap 'kill $DIAG 2>/dev/null || true' EXIT

"$ROOT/bin/aws.sh" --quiet -e SPIKES=400 scenarios/spike.js 2>&1 | tee -a "$LOG"
wait $DIAG || true
echo "로그: $LOG"
